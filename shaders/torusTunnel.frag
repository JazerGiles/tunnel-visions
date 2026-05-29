// TorusTunnel — crystal surface (Nimitz triangle-wave technique)
#version 330

uniform float time;
uniform float tunnelAngle;
uniform vec2  resolution;
uniform vec3  camPos;
uniform vec3  camFwd;
uniform vec3  camRight;
uniform vec3  camUp;

in  vec2 ndcPos;
layout (location = 0) out vec4 frag_out0;

// -----------------------------------------------------------------
// Torus parameters
// -----------------------------------------------------------------
const float R         = 110.0;  // ring radius
const float RH        =  39.0;  // radial tube half-extent
const float RV        =  44.0;  // vertical tube half-extent
const float PATH_AMP  =   6.0;  // radial path oscillation amplitude
const float PATH_FRQ  =   1.0;  // radial waves per revolution — keep at 1 to avoid left/right chaos
const float PATH_VAMP =   8.0;  // vertical path oscillation amplitude

// -----------------------------------------------------------------
// Crystal noise — triangle-wave (Nimitz technique)
// -----------------------------------------------------------------
vec3 tri(in vec3 x) { return abs(x - floor(x) - 0.5); }

float surfFunc(in vec3 p) {
    p *= vec3(1.0, 1.0, 1.5);
    return dot(tri(p * 0.5 + tri(p * 1.65 + 0.002*time).yzx), vec3(0.333));
}

float asymSin(float x) { return sin(x - 0.5 * sin(x)); }

// -----------------------------------------------------------------
// Torus geometry
// -----------------------------------------------------------------
const float OMEGA = 0.025;

vec3 torusFrame(vec3 p) {
    float ang = -tunnelAngle;
    float c = cos(ang), s = sin(ang);
    return vec3(c*p.x + s*p.z, p.y, -s*p.x + c*p.z);
}

// Inverse of torusFrame — torus-local back to world
vec3 torusToWorld(vec3 tp) {
    float c = cos(tunnelAngle), s = sin(tunnelAngle);
    return vec3(c*tp.x + s*tp.z, tp.y, -s*tp.x + c*tp.z);
}

float smax0(float x, float k) {
    float h = max(k - abs(x), 0.0) / k;
    return max(0.0, x) + h * h * k * 0.25;
}

float wallBump(vec3 tp, vec2 q, float theta) {
    float arc = theta * R * 0.5;  // halve all spatial freqs → bumps twice as large
    float qx  = q.x  * 0.5;
    float py  = tp.y * 0.5;
    float tm  = time * 0.003;
    return sin(qx * 0.31 + arc * 0.13 + tm)       * cos(py * 0.24 + arc * 0.09 - tm * 0.7) * 0.60
         + cos(qx * 0.47 - arc * 0.21 + tm * 1.3) * sin(py * 0.35 + tm * 0.5)              * 0.26
         + sin(arc * 0.29 + py * 0.17 + qx * 0.19 - tm * 0.9)                              * 0.18
         + cos(qx * 0.68 + arc * 0.44 - py * 0.31 + tm * 1.7)                              * 0.10;
}

// Vertical path — independent frequencies from the radial path so up/down and left/right
// are decoupled. Two incommensurate terms give non-repeating feel.
float pathVertical(float theta) {
    return PATH_VAMP * (sin(2.1 * theta) + 0.6 * sin(3.5 * theta + 0.7));
}

float sceneSDF(vec3 p) {
    vec3  tp    = torusFrame(p);
    float theta = atan(tp.z, tp.x);
    float rpath = R + PATH_AMP * asymSin(PATH_FRQ * theta) + pathVertical(theta);

    vec2  q    = vec2(length(tp.xz) - rpath, tp.y);
    float base = length(vec2(q.x / RH, q.y / RV)) - 1.0;

    float bump = wallBump(tp, q, theta);
    base -= 0.15 * bump;

    vec3  cc   = vec3(q.x, tp.y, theta * R);
    const float cA = 0.9744, sA = 0.2250;
    vec3  ccr  = vec3(cA*cc.x + sA*cc.z, cc.y, -sA*cc.x + cA*cc.z);
    float sparse = surfFunc(ccr * vec3(0.14, 0.15, 0.136));
    float sf     = surfFunc(ccr * 0.2);
    float nookBias  = clamp(1.0 + bump * 1.0, 0.5, 2.0);
    // Floor bias: crystals on inner wall (q.x=-RH) fade to zero above the midline
    float floorBias = max(0.07, 1.0 - smoothstep(-RH * 0.5, RH * 0.35, q.x));
    float disp = smax0((0.10 + sparse * 0.35) - sf, 0.01) * 0.25 * nookBias * floorBias;

    return base + disp;
}

// -----------------------------------------------------------------
// Ray march
// -----------------------------------------------------------------
float march(vec3 ro, vec3 rd) {
    float t = 0.01;
    for (int i = 0; i < 250; i++) {
        float d = sceneSDF(ro + t * rd);
        if (d > -0.001) return t;
        t -= d*4.5;
        if (t > 200.0) break;
    }
    return -1.0;
}

// -----------------------------------------------------------------
// Normal, AO, curvature
// -----------------------------------------------------------------
vec3 calcNormal(vec3 p) {
    const vec2 e = vec2(0.002, 0.0);
    return normalize(vec3(
        sceneSDF(p + e.xyy) - sceneSDF(p - e.xyy),
        sceneSDF(p + e.yxy) - sceneSDF(p - e.yxy),
        sceneSDF(p + e.yyx) - sceneSDF(p - e.yyx)));
}

float calculateAO(vec3 p, vec3 n) {
    float occ = 0.0, sca = 1.0;
    for (int i = 1; i <= 6; i++) {
        float h = float(i) * 0.092;
        float d = sceneSDF(p + n * h);
        occ += max(0.0, h + d) * sca;
        sca *= 0.1;
    }
    return clamp(1.0 - 3.0 * occ, 0.0, 1.0);
}

float curve(in vec3 p, in float w) {
    vec2 e = vec2(-1.0, 1.0) * w;
    float t1 = sceneSDF(p + e.yxx), t2 = sceneSDF(p + e.xxy);
    float t3 = sceneSDF(p + e.xyx), t4 = sceneSDF(p + e.yyy);
    return 0.125 / (w * w) * (t1 + t2 + t3 + t4 - 4.0 * sceneSDF(p));
}

// -----------------------------------------------------------------
// Subsurface glow — 2D gaussian blobs drifting behind crystal walls
// -----------------------------------------------------------------
float ssGlow(vec2 uv, vec2 c, float r) {
    vec2 d = uv - c;
    return exp(-dot(d, d) / (r * r));
}

vec3 subsurfContrib(vec3 pos, float gate) {
    vec3  tp    = torusFrame(pos);
    float theta = atan(tp.z, tp.x);
    vec2  uv    = vec2(theta * R, tp.y);

    vec3 col = vec3(0.0);
    col += vec3(0.50, 0.10, 1.00) * ssGlow(uv, vec2(sin(time*0.120)*222.0,                          sin(time*0.090)*5.0), 67.0);
    col += vec3(1.00, 0.20, 0.50) * ssGlow(uv, vec2(cos(time*0.150)*233.0,                          sin(time*0.083)*5.5), 78.0);
    col += vec3(0.30, 1.00, 0.40) * ssGlow(uv, vec2(sin(time*0.210)*167.0 + sin(time*0.070)*100.0, cos(time*0.130)*4.0), 50.0);

    return col * (gate * 3.5 + 0.22);
}

// -----------------------------------------------------------------
// Crystal mask
// -----------------------------------------------------------------
float crystalMask(vec3 pos) {
    vec3  tp     = torusFrame(pos);
    float theta  = atan(tp.z, tp.x);
    float rpath  = R + PATH_AMP * asymSin(PATH_FRQ * theta) + pathVertical(theta);
    vec2  q      = vec2(length(tp.xz) - rpath, tp.y);
    vec3  cc     = vec3(q.x, tp.y, theta * R);
    const float cA = 0.9744, sA = 0.2250;
    vec3  ccr    = vec3(cA*cc.x + sA*cc.z, cc.y, -sA*cc.x + cA*cc.z);
    float sparse = surfFunc(ccr * vec3(0.4, 0.5, 0.16));
    float sf     = surfFunc(ccr * 0.2);
    float bump   = wallBump(tp, q, theta);
    float nookBias  = clamp(0.6 + bump * 1.0, 0.05, 2.0);
    float floorBias = max(0.07, 1.0 - smoothstep(-RH * 0.5, RH * 0.35, q.x));
    float disp   = smax0((0.10 + sparse * 0.35) - sf, 0.01) * 0.25 * nookBias * floorBias;
    // Higher threshold so crystals must actually protrude before they get colored
    return smoothstep(0.0001, 0.0012, disp*floorBias);
}

// Seam lines between crystal facets.  The tri-wave fold is at surfFunc = 0;
// a narrow smoothstep there gives a crisp line on each facet boundary.
float crystalSeam(vec3 pos) {
    vec3  tp    = torusFrame(pos);
    float theta = atan(tp.z, tp.x);
    float rpath = R + PATH_AMP * asymSin(PATH_FRQ * theta) + pathVertical(theta);
    vec2  q     = vec2(length(tp.xz) - rpath, tp.y);
    vec3  cc    = vec3(q.x, tp.y, theta * R);
    const float cA = 0.9744, sA = 0.2250;
    vec3  ccr   = vec3(cA*cc.x + sA*cc.z, cc.y, -sA*cc.x + cA*cc.z);
    float sf        = surfFunc(ccr * vec3(0.4, 0.5, 0.36));
    float floorBias = max(0.07, 1.0 - smoothstep(-RH * 0.5, RH * 0.35, q.x));
    // sf in [0, 0.5]; fold = 0.  Adjust 0.06 to change seam width.
    return (1.0 - smoothstep(0.0, 0.16, sf)) * floorBias;
}

// -----------------------------------------------------------------
// Tunnel point lights — 3 lights drifting along the path
// -----------------------------------------------------------------
vec3 tunnelLighting(vec3 pos, vec3 nor, vec3 rd, float crystMask) {
    vec3 lc[3] = vec3[3](
        vec3(0.9,  0.35, 1.0 ),   // purple
        vec3(1.0,  0.25, 0.55),   // hot pink
        vec3(0.25, 0.85, 1.0 )    // cyan
    );
    vec3 total = vec3(0.0);
    for (int i = 0; i < 3; i++) {
        float phase  = float(i) * 2.094;                       // 120° spacing
        float spd    = 0.012 * (1.0 + float(i) * 0.5);
        float thetaL = phase + time * spd;
        float rpL    = R + PATH_AMP * asymSin(PATH_FRQ * thetaL) + pathVertical(thetaL);
        float radW   = sin(time * 0.07 + phase) * 6.0;
        float verW   = cos(time * 0.09 + phase) * 3.0;        // Y wander (left/right from camera)
        vec3  tp     = vec3((rpL + radW) * cos(thetaL), verW, (rpL + radW) * sin(thetaL));
        vec3  lpos   = torusToWorld(tp);

        vec3  lvec   = lpos - pos;
        float ldist  = length(lvec);
        vec3  ldir   = lvec / ldist;
        float att    = 1.0 / (1.0 + ldist * ldist * 0.0008);  // reach farther so walls get lit
        float diff   = abs(dot(nor, ldir));
        vec3  hVec   = normalize(-rd + ldir);
        float spec   = pow(max(0.0, dot(nor, hVec)), 28.0);
        // Neutral diffuse on bare rock so ceiling stays one color; colored only on crystals
        vec3 wallDiff = vec3(0.45, 0.45, 0.55) * diff * 0.6;
        total += (mix(wallDiff, lc[i] * diff * 1.0, crystMask)
                 + lc[i] * spec * (0.1 + crystMask * 3.0)) * att;
    }
    return total;
}

// -----------------------------------------------------------------
// Render
// -----------------------------------------------------------------
vec3 render(vec3 ro, vec3 rd) {
    float t = march(ro, rd);

    vec3 wallCol = vec3(0.0);
    if (t > 0.0) {
        vec3 pos = ro + t * rd;
        vec3 nor = calcNormal(pos);

        float distFade = exp(-0.018 * t);
        float edgeMask = crystalSeam(pos) * distFade;
        float crystMsk = crystalMask(pos) * distFade;

        vec3 seamCol = vec3(0.42, 0.25, 0.55) * nor.x
                     + vec3(0.40, 0.54, 0.12) * nor.y
                     + vec3(0.84, 0.12, 0.86) * nor.z;

        vec3 col = seamCol * edgeMask * crystMsk;
        col += seamCol * crystMsk * 0.30;
        col += subsurfContrib(pos, max(edgeMask, 0.28) * crystMsk) * crystMsk;


        // Normal-variation ambient — different wall faces get distinct hues for surface form
        vec3 nAmb = vec3(0.040, 0.030, 0.060)
                  + vec3(0.030, 0.018, 0.045) * abs(nor.x)
                  + vec3(0.014, 0.022, 0.010) * abs(nor.y);
        col += nAmb * (1.0 - crystMsk * 0.65);

        // Camera headlamp — consistent fill so walls always show surface shape
        vec3  eyeVec  = camPos - pos;
        float eyeDist = length(eyeVec);
        float eyeDiff = abs(dot(nor, eyeVec / eyeDist));
        float eyeAtt  = 1.0 / (1.0 + eyeDist * eyeDist * 0.001);
        col += vec3(0.07, 0.055, 0.10) * eyeDiff * eyeAtt * (1.0 - crystMsk * 0.4);

        col += tunnelLighting(pos, nor, rd, crystMsk);

        float fresnel = pow(1.0 - max(0.0, dot(nor, -rd)), 3.0);
        col += seamCol * fresnel * crystMsk * 10.0;

        vec3 reflDir = reflect(rd, nor);
        vec3 reflEnv = vec3(0.42, 0.25, 0.55) * abs(reflDir.x)
                     + vec3(0.40, 0.54, 0.12) * abs(reflDir.y)
                     + vec3(0.84, 0.12, 0.86) * abs(reflDir.z);
        float reflF = pow(1.0 - max(0.0, dot(nor, -rd)), 2.0);
        col += reflEnv * reflF * crystMsk * 5.0;

        float fog = 1.0 - exp(-0.03 * t);
        col = mix(col, vec3(0.01, 0.01, 0.02), fog);
        col *= calculateAO(pos, nor);

        wallCol = col;
    } else {
        wallCol = vec3(0.01, 0.01, 0.02);
    }

    return wallCol;
}

// -----------------------------------------------------------------
// Main
// -----------------------------------------------------------------
void main() {
    vec2 xy = ndcPos;
    vec2 s  = xy * vec2(resolution.x / resolution.y, 1.0);

    vec3 ro = camPos;
    vec3 rd = normalize(camFwd + s.x * camRight + s.y * camUp);

    vec3 col = render(ro, rd);

    col *= 0.6 + 0.4 * pow((xy.x+1.0)*(xy.y+1.0)*(xy.x-1.0)*(xy.y-1.0), 0.1);

    frag_out0 = vec4(col, 1.0);
}
