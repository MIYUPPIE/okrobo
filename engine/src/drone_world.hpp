#pragma once

// OKROBO engine: drone. Point-mass kinematics, same spirit as the car
// (Phase 1-4: no physics engine) and the arm (Phase 5: no solver). Shares
// the car's arena footprint (arena_width/height, robot_radius) and clamps
// to it the same way; altitude clamps to [0, max_altitude]. Flies above the
// ground-level obstacles, so unlike the car it has no obstacle-aware
// sensor -- only the arena walls are a hazard.
// Implements contracts/robot-api/v2. Reference spec: runtime/python/okrobo/_sim.py (DroneWorld).
// Units: meters, radians, seconds. theta=0 faces +x, CCW positive, normalized to (-pi, pi].

#include <cstdint>

namespace okrobo {

struct DronePose {
    double x = 0.0;
    double y = 0.0;
    double z = 0.0;
    double theta = 0.0;
};

struct DroneConfig {
    double arena_width = 2.0;
    double arena_height = 2.0;
    double robot_radius = 0.1;
    double max_altitude = 1.0;
    DronePose start{1.0, 1.0, 0.0, 0.0};
};

struct DroneState {
    std::uint64_t tick = 0;
    DronePose pose;
    double distance = 0.0;  // to the nearest wall along heading, meters
    bool collided = false;
};

class DroneWorld {
public:
    explicit DroneWorld(const DroneConfig& config = DroneConfig{});

    void drive(double forward, double vertical, double yaw_rate);  // m/s, m/s, rad/s
    void stop();
    void reset();
    void step(double dt);

    DroneState state() const;

    /** Horizontal distance to the nearest arena wall along heading+offset. */
    double ray(double offset) const;

private:
    double sensor_distance() const;

    DroneConfig config_;
    DronePose pose_;
    double forward_ = 0.0;
    double vertical_ = 0.0;
    double yaw_rate_ = 0.0;
    std::uint64_t tick_ = 0;
    bool collided_ = false;
};

}  // namespace okrobo
