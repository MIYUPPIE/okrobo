#pragma once

// Robot camera: a raycast renderer over the world's walls and obstacles.
//
// Deliberately computed in the engine rather than grabbed from the Three.js
// viewport, so a camera image exists everywhere the simulator does — headless
// in the sidecar, in the browser, and in the parity gate — and is
// deterministic, which a GPU render is not. That determinism is what lets
// computer-vision lessons have reliable answers.
//
// Each column is one ray; walls and obstacles are drawn as vertical bands
// whose height falls off with distance, shaded darker further away, so a
// student's code sees recognisable coloured shapes.

#include "world.hpp"

#include <cmath>
#include <cstddef>
#include <cstdint>

namespace okrobo {

constexpr int kCameraMaxWidth = 160;
constexpr int kCameraMaxHeight = 120;
constexpr double kCameraFov = 1.0471975511965976;  // 60 degrees
constexpr double kCameraFarPlane = 4.0;            // metres

/// Render one RGB frame into `out` (width * height * 3 bytes, row-major from
/// the top). Returns the number of bytes written, or 0 if the size is invalid.
inline int render_camera(const World& world, int width, int height, unsigned char* out) {
    if (!out || width <= 0 || height <= 0) return 0;
    if (width > kCameraMaxWidth || height > kCameraMaxHeight) return 0;

    for (int column = 0; column < width; ++column) {
        // Ray angles sweep left to right across the field of view, matching
        // the image so column 0 is what the student sees on the left.
        const double fraction = width == 1 ? 0.5 : static_cast<double>(column) / (width - 1);
        const double offset = kCameraFov / 2.0 - fraction * kCameraFov;
        const RayHit hit = world.ray_hit(offset);

        // Perpendicular distance keeps flat surfaces flat instead of bowing.
        const double distance = hit.distance * std::cos(offset);
        const double clamped = distance < 0.05 ? 0.05 : distance;

        // Band height falls off as 1/distance, capped to the frame.
        double band = static_cast<double>(height) / (clamped * 2.0);
        if (band > height) band = height;
        const int top = static_cast<int>((height - band) / 2.0);
        const int bottom = static_cast<int>((height + band) / 2.0);

        // Darken with distance so depth is visible in the image.
        double shade = 1.0 - (clamped / kCameraFarPlane);
        if (shade < 0.15) shade = 0.15;
        if (shade > 1.0) shade = 1.0;

        for (int row = 0; row < height; ++row) {
            unsigned char* pixel = out + (static_cast<size_t>(row) * width + column) * 3;
            if (row < top) {
                // Sky
                pixel[0] = 22;
                pixel[1] = 24;
                pixel[2] = 29;
            } else if (row >= bottom) {
                // Floor
                pixel[0] = 26;
                pixel[1] = 34;
                pixel[2] = 48;
            } else {
                pixel[0] = static_cast<unsigned char>(hit.r * shade);
                pixel[1] = static_cast<unsigned char>(hit.g * shade);
                pixel[2] = static_cast<unsigned char>(hit.b * shade);
            }
        }
    }
    return width * height * 3;
}

}  // namespace okrobo
