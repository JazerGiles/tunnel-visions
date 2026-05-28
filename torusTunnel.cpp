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
static constexpr float OMEGA = 0.055f;  // torus rotation speed (rad/s)
static constexpr float PATH_AMP = 6.0f; // path Y amplitude
static constexpr float PATH_FRQ = 1.0f; // path waves per revolution

// Slow-rise / steep-fall sine (same formula as shader)
static float asymSin(float x)      { return std::sin(x - 0.5f * std::sin(x)); }
static float asymSinDeriv(float x) { return std::cos(x - 0.5f * std::sin(x)) * (1.0f - 0.5f * std::cos(x)); }

struct TorusTunnelApp : public App
{
    VAOMesh quad;
    ShaderProgram shader;
    SearchPaths searchPaths;

    double elapsedTime = 0.0;
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
        nav().pos(Vec3d(10.5, 0.0, 0.0));
        nav().faceToward(Vec3d(10.5, 0.0, 1.0), Vec3d(1, 0, 0));
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
            elapsedTime += dt * timeScale;

        // Camera angle in torus frame advances at OMEGA rad/s.
        // Path displaces RADIALLY: rpath = R + amp*asymSin(freq*beta).
        // Camera tracks this so it stays centred in the tube. Radial = camera up/down.
        const float camR0 = 16.0f - 1.5f; // base radial position (1.5 inside ring, R=16)
        float beta = (float)elapsedTime * OMEGA;
        float arg = PATH_FRQ * beta;
        float sinVal = asymSin(arg);
        float dsindt = asymSinDeriv(arg) * PATH_FRQ * OMEGA;
        float cam_r  = camR0 + PATH_AMP * sinVal;
        nav().pos(Vec3d(cam_r, 0.0, 0.0));

        // Tilt down only on descent (dsindt < 0), after passing the 0.7 threshold.
        // Ramps in linearly: 0 at sinVal=0.7, full at sinVal=0.2.
        float descFrac = std::max(0.0f, std::min(1.0f, (0.7f - sinVal) / 0.5f));
        float tiltMask = (dsindt < 0.0f) ? descFrac : 0.0f;
        float tiltR    = tiltMask * dsindt * PATH_AMP * 0.5f;
        nav().faceToward(Vec3d(cam_r + tiltR, 0.0, 1.0), Vec3d(1, 0, 0));
    }

    void onDraw(Graphics &g) override
    {
        g.clear(0);
        shader.use();
        shader.uniform("time", (float)elapsedTime);
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
