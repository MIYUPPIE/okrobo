#pragma once

// OKROBO engine core: differential-drive robot in a rectangular arena.
// Implements contracts/robot-api/v0. Reference spec: runtime/python/okrobo/_sim.py.
// Units: meters, radians, seconds. theta=0 faces +x, CCW positive, normalized to (-pi, pi].

#include <cstdint>

namespace okrobo {

struct Pose {
    double x = 0.0;
    double y = 0.0;
    double theta = 0.0;
};

struct WorldConfig {
    double arena_width = 2.0;   // x extent, meters
    double arena_height = 2.0;  // y extent, meters
    double robot_radius = 0.1;
    double wheel_base = 0.12;
    Pose start{1.0, 1.0, 0.0};
};

struct State {
    std::uint64_t tick = 0;
    Pose pose;
    double distance = 0.0;  // front edge to wall along heading
    bool collided = false;
};

class World {
public:
    explicit World(const WorldConfig& config = WorldConfig{});

    void drive(double left, double right);  // wheel linear speeds, m/s
    void stop();
    void reset();
    void step(double dt);

    State state() const;

private:
    double sensor_distance() const;

    WorldConfig config_;
    Pose pose_;
    double left_ = 0.0;
    double right_ = 0.0;
    std::uint64_t tick_ = 0;
    bool collided_ = false;
};

}  // namespace okrobo
