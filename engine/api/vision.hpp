#pragma once

// Student-facing C++ computer vision: header-only, real, and standalone.
//
//   #include "robot.hpp"
//   #include "vision.hpp"
//   int main() {
//       okrobo::Robot robot;
//       auto target = okrobo::find_color(robot.camera(), "red");
//       if (target) { /* target->bearing, target->coverage, target->area */ }
//   }
//
// A direct C++ port of runtime/python/okrobo/vision.py's find_color: works
// with no dependencies (no OpenCV), so it needs nothing beyond a C++17
// compiler, matching how the Python version needs nothing beyond CPython.
// Operates on robot.hpp's Frame, which camera() already fills from the same
// deterministic engine renderer every other language uses -- this header
// adds no new colour-matching math, only the C++ port of the algorithm.

#include <array>
#include <cmath>
#include <cstddef>
#include <map>
#include <optional>
#include <stdexcept>
#include <string>

#include "robot.hpp"

namespace okrobo {

/** Where something coloured is in the frame. */
struct Detection {
    std::string color;
    double x = 0.0;   // pixel column of the blob's centre
    double y = 0.0;   // pixel row of the blob's centre
    int area = 0;      // how many pixels matched
    double bearing = 0.0;    // degrees from straight ahead; negative is left, positive is right
    double coverage = 0.0;   // fraction of the frame covered, 0..1
};

/** Named colours a student can ask for, as (r, g, b) references. Matches okrobo.vision.COLORS. */
inline const std::map<std::string, std::array<int, 3>>& vision_colors() {
    static const std::map<std::string, std::array<int, 3>> colors = {
        {"red", {220, 40, 40}},
        {"green", {40, 200, 80}},
        {"blue", {60, 110, 230}},
        {"yellow", {230, 210, 60}},
    };
    return colors;
}

namespace detail {

// Hue-like ratio match, not absolute values: a distant box is darker but still that colour.
inline bool color_matches(int r, int g, int b, const std::array<int, 3>& reference, double tolerance) {
    const int total = r + g + b;
    if (total < 40) return false;  // too dark to have a colour
    const int ref_total = reference[0] + reference[1] + reference[2];
    const int channel[3] = {r, g, b};
    for (int i = 0; i < 3; ++i) {
        const double diff = static_cast<double>(channel[i]) / total -
                             static_cast<double>(reference[i]) / ref_total;
        if (std::abs(diff) > tolerance) return false;
    }
    return true;
}

}  // namespace detail

/** Finds the largest patch of a named colour, or nullopt if it is not there. */
inline std::optional<Detection> find_color(const Frame& frame, const std::string& color,
                                            double tolerance = 0.12) {
    const auto& colors = vision_colors();
    const auto found = colors.find(color);
    if (found == colors.end()) {
        throw std::invalid_argument("unknown colour: " + color);
    }
    const auto& reference = found->second;

    constexpr double kCameraFovLocal = 1.0471975511965976;  // matches camera.hpp's kCameraFov
    long total_x = 0;
    long total_y = 0;
    int count = 0;
    for (int y = 0; y < frame.height; ++y) {
        const auto row = static_cast<std::size_t>(y) * frame.width * 3;
        for (int x = 0; x < frame.width; ++x) {
            const auto i = row + static_cast<std::size_t>(x) * 3;
            if (detail::color_matches(frame.pixels[i], frame.pixels[i + 1], frame.pixels[i + 2],
                                       reference, tolerance)) {
                total_x += x;
                total_y += y;
                ++count;
            }
        }
    }
    if (count == 0) return std::nullopt;

    const double centre_x = static_cast<double>(total_x) / count;
    const double fraction = frame.width == 1 ? 0.5 : centre_x / (frame.width - 1);
    // Column 0 is the left edge of the field of view (matches camera.render).
    const double bearing_radians = fraction * kCameraFovLocal - kCameraFovLocal / 2.0;

    Detection detection;
    detection.color = color;
    detection.x = centre_x;
    detection.y = static_cast<double>(total_y) / count;
    detection.area = count;
    detection.bearing = bearing_radians * 180.0 / 3.14159265358979323846;
    detection.coverage = static_cast<double>(count) / (frame.width * frame.height);
    return detection;
}

}  // namespace okrobo
