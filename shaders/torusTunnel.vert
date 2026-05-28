#version 330

layout (location = 0) in vec3 position;

out vec2 ndcPos;

void main() {
    gl_Position = vec4(position.xy, -1.0, 1.0);
    ndcPos = position.xy;
}
