// TorusTunnel — camera inside the tube of an auto-rotating torus
// Build from allolib_playground root:
//   mkdir -p MAT201B-2024-Jazer/torusTunnel/build
//   cd MAT201B-2024-Jazer/torusTunnel/build
//   cmake -DAL_APP_FILE=../torusTunnel.cpp ../../..
//   make -j4
//   cd ../bin && ./torusTunnel
//
// Navigation: WASD + mouse (allolib default)
// Keys: SPACE pause/resume   +/- speed   0 reset speed   R reload shaders

#include "al/app/al_App.hpp"
#include "al/io/al_File.hpp"
#include "al/graphics/al_Shader.hpp"
#include "al/graphics/al_VAOMesh.hpp"
#include <cmath>
#include <algorithm>

using namespace al;

// Must match shader constants exactly
static constexpr float OMEGA = 0.025f;    // torus rotation speed (rad/s)
static constexpr float PATH_AMP = 6.0f;   // path radial amplitude
static constexpr float PATH_FRQ = 1.0f;   // radial waves per revolution — must match shader
static constexpr float PATH_VAMP = 8.0f;  // path vertical amplitude — must match shader

// Slow-rise / steep-fall sine (same formula as shader)
static float asymSin(float x) { return std::sin(x - 0.5f * std::sin(x)); }
static float asymSinDeriv(float x) { return std::cos(x - 0.5f * std::sin(x)) * (1.0f - 0.5f * std::cos(x)); }

struct TorusTunnelApp : public App
{
    VAOMesh quad;
    ShaderProgram shader;
    SearchPaths searchPaths;

    double elapsedTime = 0.0;
    double tunnelAngle = 0.0; // torus rotation phase, advances at variable rate
    double timeScale = 1.0;
    bool paused = false;

    struct WatchedFile
    {
        File file;
        al_sec modified;
    };
    std::map<std::string, WatchedFile> watchedFiles;
    al_sec watchCheckTime = 0;

    void onInit() override
    {
        searchPaths.addSearchPath(".", false);
        searchPaths.addAppPaths();
        searchPaths.addRelativePath("../shaders", true);

        // R=12, camera 1.5 inside the ring radially; up = radially outward (+X at angle 0)
        // so inner wall is floor, outer wall is ceiling — same feel as original.
        nav().pos(Vec3d(110.0, 0.0, 0.0));
        nav().faceToward(Vec3d(110.0, 0.0, 1.0), Vec3d(1, 0, 0));
    }

    void onCreate() override
    {
        quad.primitive(Mesh::TRIANGLE_STRIP);
        quad.vertex(-1, -1, 0);
        quad.vertex(1, -1, 0);
        quad.vertex(-1, 1, 0);
        quad.vertex(1, 1, 0);
        quad.update();
        loadShader();
    }

    void onAnimate(double dt) override
    {
        if (watchCheck())
        {
            printf("shaders changed, reloading\n");
            loadShader();
        }
        if (!paused)
        {
            elapsedTime += dt * timeScale;

            // Speed modulation: slow at the crest (sinVal≈+1), faster in the dip (sinVal≈-1).
            // speedMod ∈ [0.7, 1.3] — adjust the 0.30 coefficient to taste.
            float arg0 = PATH_FRQ * (float)tunnelAngle;
            float sinVal0 = asymSin(arg0);
            float speedMod = 1.0f - sinVal0 * 0.30f;
            tunnelAngle += dt * timeScale * OMEGA * speedMod;
        }

        const float camR0 = 110.0f;
        float arg = PATH_FRQ * (float)tunnelAngle;
        float sinVal = asymSin(arg);
        float dsindt = asymSinDeriv(arg) * PATH_FRQ * OMEGA;
        float cam_r = camR0 + PATH_AMP * sinVal;

        // Radial path oscillation — matches shader pathVertical(), applied to cam_r.
        // Radial = camera up/down axis (outer wall is "up" in this tunnel).
        auto pathRadial = [](float theta) -> float
        {
            return PATH_VAMP * (std::sin(2.1f * theta) + 0.6f * std::sin(3.5f * theta + 0.7f));
        };
        cam_r += pathRadial((float)tunnelAngle);
        nav().pos(Vec3d(cam_r, 0.0, 0.0));

        float descFrac = std::max(0.0f, std::min(1.0f, (0.7f - sinVal) / 0.5f));
        float tiltMask = (dsindt < 0.0f) ? descFrac : 0.0f;
        float tiltR = tiltMask * dsindt * PATH_AMP * 0.5f;
        // Look slightly ahead on radial path; Y stays 0 so camera never rolls.
        float futAngle  = (float)tunnelAngle + 0.03f;
        float futCamR   = camR0 + PATH_AMP * asymSin(PATH_FRQ * futAngle) + pathRadial(futAngle);
        nav().faceToward(Vec3d(futCamR + tiltR, 0.0, 15.0), Vec3d(1, 0, 0));
    }

    void onDraw(Graphics &g) override
    {
        g.clear(0);
        shader.use();
        shader.uniform("time", (float)elapsedTime);
        shader.uniform("tunnelAngle", (float)tunnelAngle);
        shader.uniform("resolution", Vec2f((float)width(), (float)height()));

        Vec3d p = nav().pos();
        Vec3d uf = nav().uf();
        Vec3d ur = nav().ur();
        Vec3d uu = nav().uu();

        shader.uniform("camPos", Vec3f((float)p.x, (float)p.y, (float)p.z));
        shader.uniform("camFwd", Vec3f((float)uf.x, (float)uf.y, (float)uf.z));
        shader.uniform("camRight", Vec3f((float)ur.x, (float)ur.y, (float)ur.z));
        shader.uniform("camUp", Vec3f((float)uu.x, (float)uu.y, (float)uu.z));

        quad.draw();
    }

    bool onKeyDown(const Keyboard &k) override
    {
        switch (k.key())
        {
        case ' ':
            paused = !paused;
            return true;
        case '=':
            timeScale *= 2.0;
            return true;
        case '-':
            timeScale *= 0.5;
            return true;
        case '0':
            timeScale = 1.0;
            return true;
        case 'r':
            loadShader();
            return true;
        }
        return false;
    }

    void watchFile(const std::string &path)
    {
        File file(searchPaths.find(path).filepath());
        watchedFiles[path] = WatchedFile{file, file.modified()};
    }

    bool watchCheck()
    {
        bool changed = false;
        if (floor(al_system_time()) > watchCheckTime)
        {
            watchCheckTime = floor(al_system_time());
            for (auto &kv : watchedFiles)
            {
                WatchedFile &wf = kv.second;
                if (wf.modified != wf.file.modified())
                {
                    wf.modified = wf.file.modified();
                    changed = true;
                }
            }
        }
        return changed;
    }

    std::string loadGlsl(const std::string &filename)
    {
        watchFile(filename);
        return File::read(searchPaths.find(filename).filepath());
    }

    void loadShader()
    {
        shader.compile(loadGlsl("torusTunnel.vert"),
                       loadGlsl("torusTunnel.frag"));
    }
};

int main()
{
    TorusTunnelApp app;
    app.dimensions(1200, 800);
    app.title("Torus Tunnel");
    app.start();
}
