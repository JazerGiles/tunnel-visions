// TorusTunnel — crystal surface style (Nimitz triangle-wave technique)
// Fast: surfFunc uses only abs/fract, no trig or exp in SDF.
#version 330

uniform float time;
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
const float R        = 18.0;   // ring radius — larger gives headroom for wide tube + path amp
const float RH       =  11.5;   // radial tube half-extent  (floor/ceiling distance)
const float RV       = 16.0;   // vertical tube half-extent (side-wall distance)
const float PATH_AMP =  6.0;   // path radial oscillation amplitude
const float PATH_FRQ =  1.0;   // sine waves per full revolution

// -----------------------------------------------------------------
// Crystal noise — triangle-wave (Nimitz technique, ~10 arithmetic ops)
// -----------------------------------------------------------------
vec3 tri(in vec3 x) { return abs(x - floor(x) - 0.5); }

float surfFunc(in vec3 p) {
    p *= vec3(1.0, 1.0, 1.5);
    return dot(tri(p * 0.5 + tri(p * 1.65 + 0.002*time).yzx), vec3(0.333));
}

// Asymmetric sine: slow rise (low slope), steep fall (high slope).
// sin(x - 0.5*sin(x)) — derivative at x=0 is 0.5 (slow), at x=π is 1.5 (fast).
float asymSin(float x) {
    return sin(x - 0.5 * sin(x));
}

// -----------------------------------------------------------------
// Torus geometry
// -----------------------------------------------------------------
// half-period = π / (PATH_FRQ * OMEGA) = π / (1 * 0.055) ≈ 57 s per rise or fall
const float OMEGA = 0.055;

vec3 torusFrame(vec3 p) {
    float ang = -time * OMEGA;
    float c = cos(ang), s = sin(ang);
    return vec3(c*p.x + s*p.z, p.y, -s*p.x + c*p.z);
}

// Smooth ramp: like max(0, x) but with a rounded fillet of radius k at the base.
// IQ polynomial form — C1 continuous, zero cost when x >> k.
float smax0(float x, float k) {
    float h = max(k - abs(x), 0.0) / k;
    return max(0.0, x) + h * h * k * 0.25;
}

float sceneSDF(vec3 p) {
    vec3  tp    = torusFrame(p);
    float theta = atan(tp.z, tp.x);                     // ring angle in torus frame
    float rpath = R + PATH_AMP * asymSin(PATH_FRQ * theta); // displaced ring radius

    // q.x = deviation from displaced ring radius (camera vertical = radially outward)
    // q.y = deviation in world Y (camera horizontal — tube is upright, Y is sideways)
    vec2  q    = vec2(length(tp.xz) - rpath, tp.y);
    float base = length(vec2(q.x / RH, q.y / RV)) - 1.0;

    // Rotate cc in the radial/ring plane so crystal noise axes aren't ring-aligned
    vec3  cc   = vec3(q.x, tp.y, theta * R);
    const float cA = 0.9744, sA = 0.2250;  // cos/sin 13°  // cos/sin 6°
    vec3  ccr  = vec3(cA*cc.x + sA*cc.z, cc.y, -sA*cc.x + cA*cc.z);
    float sparse = surfFunc(ccr * vec3(0.4, 0.5, 0.36));
    float sf     = surfFunc(ccr * 0.2);
    // smax0: smooth fillet at crystal base where it meets the flat wall
    float disp = smax0((0.15 + sparse * 0.40) - sf, 0.01) * 0.55;

    return base + disp;
}

// -----------------------------------------------------------------
// Ray march
// -----------------------------------------------------------------
float march(vec3 ro, vec3 rd) {
    float t = 0.01;
    for (int i = 0; i < 300; i++) {
        float d = sceneSDF(ro + t * rd);
        if (d > -0.001) return t;
        t -= d * 0.99;
        if (t > 60.0) break;
    }
    return -1.0;
}

// -----------------------------------------------------------------
// Normal and curvature (Nimitz discrete Laplacian)
// -----------------------------------------------------------------
vec3 calcNormal(vec3 p) {
    const vec2 e = vec2(0.002, 0.0);
    return normalize(vec3(
        sceneSDF(p + e.xyy) - sceneSDF(p - e.xyy),
        sceneSDF(p + e.yxy) - sceneSDF(p - e.yxy),
        sceneSDF(p + e.yyx) - sceneSDF(p - e.yyx)));
}

float calculateAO(vec3 p, vec3 n) {
    // Inside-out: sceneSDF is negative in free space, so "free distance" = -sceneSDF.
    // Occlusion = (expected free distance h) - (actual free distance): positive when
    // a wall is closer than h.
    float occ = 0.0, sca = 1.0;
    for (int i = 1; i <= 6; i++) {
        float h = float(i) * 0.072;
        float d = sceneSDF(p + n * h);      // negative in free tunnel space
        occ += max(0.0, h + d) * sca;       // h - |d|: positive = nearby wall
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
// Subsurface glow — lights drifting behind the crystal walls
// -----------------------------------------------------------------
float ssGlow(vec2 uv, vec2 c, float r) {
    vec2 d = uv - c;
    return exp(-dot(d, d) / (r * r));
}

// edgeMask gates the glow: bright at crystal facet boundaries (thin crystal),
// dim through flat faces — mimics light scattering through thin edges.
vec3 subsurfContrib(vec3 pos, float edgeMask) {
    vec3 tp    = torusFrame(pos);
    float theta = atan(tp.z, tp.x);
    vec2 uv    = vec2(theta * R, tp.y);

    vec3 col = vec3(0.0);
    col += vec3(0.50, 0.10, 1.00) * ssGlow(uv, vec2(sin(time*0.120)*40.0,                          sin(time*0.090)*5.0), 12.0);
    col += vec3(0.10, 0.60, 1.00) * ssGlow(uv, vec2(sin(time*0.073)*35.0 + cos(time*0.190)*15.0,   cos(time*0.110)*4.5), 10.0);
    col += vec3(1.00, 0.20, 0.50) * ssGlow(uv, vec2(cos(time*0.150)*42.0,                          sin(time*0.083)*5.5), 14.0);
    col += vec3(0.30, 1.00, 0.40) * ssGlow(uv, vec2(sin(time*0.210)*30.0 + sin(time*0.070)*18.0,   cos(time*0.130)*4.0),  9.0);
    col += vec3(1.00, 0.70, 0.10) * ssGlow(uv, vec2(cos(time*0.097)*45.0,                          sin(time*0.170)*3.5), 11.0);

    return col * (edgeMask * 3.5 + 0.22);
}

// -----------------------------------------------------------------
// Value-noise FBM for organic rock texture
// -----------------------------------------------------------------
float hash3(vec3 p) {
    return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453);
}
float valueNoise(vec3 p) {
    vec3 i = floor(p), fr = fract(p);
    vec3 u = fr * fr * (3.0 - 2.0 * fr);
    float n000 = hash3(i),              n100 = hash3(i + vec3(1,0,0));
    float n010 = hash3(i + vec3(0,1,0)), n110 = hash3(i + vec3(1,1,0));
    float n001 = hash3(i + vec3(0,0,1)), n101 = hash3(i + vec3(1,0,1));
    float n011 = hash3(i + vec3(0,1,1)), n111 = hash3(i + vec3(1,1,1));
    return mix(mix(mix(n000,n100,u.x), mix(n010,n110,u.x), u.y),
               mix(mix(n001,n101,u.x), mix(n011,n111,u.x), u.y), u.z);
}
float fbmRock(vec3 p) {
    float v = 0.0, a = 0.5, total = 0.0;
    for (int i = 0; i < 5; i++) {
        v += a * valueNoise(p);
        total += a;
        p = p * 16.03 + vec3(113.3, 17.7, 114.9);
        a *= 0.52;
    }
    return v / total;
}

// -----------------------------------------------------------------
// Rock + rust — rough stone with iron-oxide water stains in smooth areas
// -----------------------------------------------------------------
vec3 rockRust(vec3 pos, vec3 nor, vec3 rd, float edgeMask) {
    vec3  tp    = torusFrame(pos);
    float theta = atan(tp.z, tp.x);
    vec2  q     = vec2(length(tp.xz) - R, tp.y);

    // FBM grey-brown rock base — use rpath so radial coord is centred on tube axis
    float rpath2 = R + PATH_AMP * asymSin(PATH_FRQ * theta);
    vec2  qt     = vec2(length(tp.xz) - rpath2, tp.y);
    vec3 rp = vec3(theta * R * 0.45, qt.x * 0.50, qt.y * 0.45);
    float rock = clamp(fbmRock(rp) * 2.2 - 0.55, 0.0, 1.0);  // boost contrast
    // Dark matte rock — noticeably more light-absorbing than crystals
    vec3 rockCol = mix(vec3(0.05, 0.04, 0.03), vec3(0.22, 0.19, 0.14), rock);

    // Rust/water stains: very small q.x scale → long vertical drips toward floor
    vec3 sp = vec3(theta * R * 0.20, q.x * 0.038, q.y * 0.16);
    float s1 = dot(tri(sp),                            vec3(0.333));
    float s2 = dot(tri(sp * 1.3 + tri(sp * 0.9).yzx),  vec3(0.333));
    float stain = s1 * 0.60 + s2 * 0.40;

    // Stains concentrate near inner wall (floor = camera-down = smaller q.x)
    stain *= 1.0 - 0.5 * smoothstep(-RH, RH * 0.3, q.x);
    stain  = clamp(stain, 0.0, 1.0);

    // Iron-oxide palette: kept dim relative to rock so wall stays matte
    vec3 rustCol = mix(vec3(0.14, 0.06, 0.01), vec3(0.38, 0.16, 0.04), stain * stain);
    vec3 col = mix(rockCol, rustCol, smoothstep(0.45, 0.65, stain));

    // Wet rust sheen — subtle, rock stays non-reflective
    float wetF = pow(1.0 - max(0.0, dot(nor, -rd)), 4.0);
    col += vec3(0.40, 0.22, 0.05) * wetF * stain * stain * 1.0;

    return col * (1.0 - edgeMask);
}

// -----------------------------------------------------------------
// Glowing orb — bug-like flight around/ahead of camera
// -----------------------------------------------------------------
vec3 getOrbPos() {
    float oy = cos(time*0.34)*1.5 + sin(time*0.57)*0.6;

    // Raw forward + lateral — incommensurate so motion feels non-repeating
    float fwd = sin(time*0.155)*9.0 + cos(time*0.095)*5.0 + sin(time*0.365)*2.0;
    float lat = sin(time*0.415)*3.5 + cos(time*0.265)*1.5;

    // Polar minimum-radius: when orb would cross through the camera it instead
    // arcs to the side (near the wall), never cutting through the midpoint.
    float r    = length(vec2(fwd, lat));
    float minR = 5.0;
    float sc   = r < minR ? minR / max(r, 0.01) : 1.0;

    return camPos + camRight*(lat*sc) + camUp*oy + camFwd*(fwd*sc);
}

// -----------------------------------------------------------------
// Orb sphere — analytical intersection + animated swirly surface
// -----------------------------------------------------------------
const float ORB_R = 0.7;

float sphereIntersect(vec3 ro, vec3 rd, vec3 cen, float rad) {
    vec3  oc = ro - cen;
    float b  = dot(rd, oc);
    float c  = dot(oc, oc) - rad * rad;
    float h  = b * b - c;
    if (h < 0.0) return -1.0;
    return -b - sqrt(h);
}

// lp = unit vector on sphere surface (local normal direction)
vec3 orbSurface(vec3 lp) {
    vec3 q = lp * 2.5;
    q += 0.50 * sin(q.yzx * 1.7 + time * 0.31);
    q += 0.35 * sin(q.zxy * 2.3 - time * 0.27 + vec3(1.1, 2.2, 0.7));

    float n1 = dot(tri(q * 0.8), vec3(0.333));
    float n2 = dot(tri(q * 1.9 + tri(q * 1.3).yzx), vec3(0.333));
    float n  = n1 * 0.55 + n2 * 0.45;

    vec3 c1 = vec3(0.05, 0.00, 0.35);   // deep indigo
    vec3 c2 = vec3(0.65, 0.10, 0.95);   // violet
    vec3 c3 = vec3(0.15, 0.90, 1.00);   // cyan
    return mix(c1, mix(c2, c3, n), n) * (0.7 + n * 2.2);
}

// Returns 1 wherever a crystal protrudes from the wall (re-evaluates the same
// displacement noise as sceneSDF), 0 on bare rock.  Covers both the bright
// facet edges AND the dark flat faces of each crystal.
float crystalMask(vec3 pos) {
    vec3  tp     = torusFrame(pos);
    float theta  = atan(tp.z, tp.x);
    float rpath  = R + PATH_AMP * asymSin(PATH_FRQ * theta);
    vec2  q      = vec2(length(tp.xz) - rpath, tp.y);
    // Identical rotation as sceneSDF so mask aligns with actual crystal geometry
    vec3  cc     = vec3(q.x, tp.y, theta * R);
    const float cA = 0.9744, sA = 0.2250;  // cos/sin 13°  // must match sceneSDF exactly
    vec3  ccr    = vec3(cA*cc.x + sA*cc.z, cc.y, -sA*cc.x + cA*cc.z);
    float sparse = surfFunc(ccr * vec3(0.4, 0.5, 0.36));
    float sf     = surfFunc(ccr * 0.2);
    float disp   = smax0((0.15 + sparse * 0.40) - sf, 0.07) * 0.55;
    return smoothstep(0.0, 0.12, disp);
}

// -----------------------------------------------------------------
// Render
// -----------------------------------------------------------------
vec3 render(vec3 ro, vec3 rd) {
    vec3  oPos   = getOrbPos();
    const vec3 orbCol = vec3(0.85, 0.75, 1.0);

    vec3  toOrb = oPos - ro;
    float tc    = dot(toOrb, rd);
    float d2    = max(0.0, dot(toOrb, toOrb) - tc * tc);

    float tOrb = sphereIntersect(ro, rd, oPos, ORB_R);
    float t    = march(ro, rd);

    // Volumetric halo outside the sphere — wisps wrap the edge.
    // Beer-Lambert so dense regions genuinely occlude rather than just adding.
    vec3  orbAccum = vec3(0.0);
    float orbT     = 1.0;
    float haloR    = ORB_R * 3.8;
    if (d2 < haloR * haloR && tc > 0.001) {
        vec3  oc = ro - oPos;
        float b  = dot(rd, oc);
        float hh = b * b - (dot(oc, oc) - haloR * haloR);
        if (hh > 0.0) {
            float tIn  = max(0.001, -b - sqrt(hh));
            float tOut = -b + sqrt(hh);
            if (t    > 0.0) tOut = min(tOut, t);
            if (tOrb > 0.001) tIn = max(tIn, tOrb);  // skip solid sphere interior
            if (tIn < tOut) {
                float seg = tOut - tIn;
                for (int i = 0; i < 6; i++) {
                    float ti  = tIn + seg * (float(i) + 0.5) / 6.0;
                    vec3  p   = ro + ti * rd;
                    vec3  lp  = p - oPos;
                    float rn  = length(lp) / ORB_R;
                    float density = exp(-rn * rn) * 4.5 * (seg / 6.0);
                    orbAccum += orbSurface(normalize(lp)) * density * orbT;
                    orbT     *= exp(-density * 1.4);
                }
            }
        }
    }
    // Smooth outer glow ring
    if (tc > 0.001 && (t < 0.0 || tc < t)) {
        orbAccum += orbCol * exp(-d2 * 0.25) * 1.25 * exp(-0.05 * tc);
    }

    // Wall shading — always evaluated so orb blend can show the wall through the edge.
    vec3 wallCol = vec3(0.0);
    if (t > 0.0) {
        vec3 pos = ro + t * rd;
        vec3 nor = calcNormal(pos);

        float crv_broad = abs(curve(pos, 0.12));
        float crv_fine  = abs(curve(pos, 0.02));
        float edgeMask  = clamp(crv_fine * 7.0 + crv_broad * 0.12, 0.0, 1.0);
        float crystMask = crystalMask(pos);

        vec3 seamCol = vec3(0.42, 0.25, 0.55) * nor.x
                     + vec3(0.40, 0.54, 0.12) * nor.y
                     + vec3(0.84, 0.12, 0.86) * nor.z;
        vec3 col = seamCol * edgeMask;

        col += subsurfContrib(pos, edgeMask);
        col += rockRust(pos, nor, rd, crystMask);

        float fresnel = pow(1.0 - max(0.0, dot(nor, -rd)), 3.0);
        col += seamCol * fresnel * crystMask * 10.0;

        vec3 reflDir = reflect(rd, nor);
        vec3 reflEnv = vec3(0.42, 0.25, 0.55) * abs(reflDir.x)
                     + vec3(0.40, 0.54, 0.12) * abs(reflDir.y)
                     + vec3(0.84, 0.12, 0.86) * abs(reflDir.z);
        float reflF = pow(1.0 - max(0.0, dot(nor, -rd)), 2.0);
        col += reflEnv * reflF * crystMask * 5.0;

        float fog = 1.0 - exp(-0.14 * t);
        col = mix(col, vec3(0.0), fog);
        col *= calculateAO(pos, nor);

        float orbDist = length(oPos - pos);
        vec3  orbDir  = (oPos - pos) / orbDist;
        float orbDiff = abs(dot(nor, orbDir)) * 4.5 / (1.0 + orbDist * orbDist * 0.05);
        col += orbCol * orbDiff;

        vec3  hVec = normalize(-rd + orbDir);
        float spec = pow(max(0.0, dot(nor, hVec)), 32.0);
        col += orbCol * spec * crystMask * 3.5 / (1.0 + orbDist * orbDist * 0.04);

        wallCol = col;
    }

    // Sphere hit: perpendicular distance from orb centre to the ray drives the blend.
    // Rays through the centre (perp=0) → fully opaque swirly surface.
    // Rays grazing the edge (perp=ORB_R) → fully transparent, shows wall behind.
    // Squared for a tighter opaque core with a wider soft fade at the boundary.
    if (tOrb > 0.001 && (t < 0.0 || tOrb < t)) {
        vec3  oSurf = ro + tOrb * rd;
        vec3  oNor  = normalize(oSurf - oPos);
        vec3  sCol  = orbSurface(oNor);
        float rim   = 1.0 - max(0.0, dot(oNor, -rd));
        sCol += orbCol * pow(rim, 2.5) * 1.0;

        // 1 - smoothstep: opaque across most of the disc, fade only in the outer 15%
        // (smoothstep requires edge0 < edge1, so we invert with 1-)
        float perp      = sqrt(d2);
        float perpBlend = 1.0 - smoothstep(ORB_R * 0.9, ORB_R * 0.99, perp);

        return mix(wallCol, sCol, perpBlend) + orbAccum;
    }

    return wallCol + orbAccum;
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
