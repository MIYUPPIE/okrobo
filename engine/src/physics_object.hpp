#pragma once

// A single graspable rigid body (a small box) resting on a floor plane.
// While held it is plain kinematics (position = wherever the caller pins
// it, e.g. the arm's tip) with no simulation cost; release() hands it to
// MuJoCo as a free body, so it actually falls and settles under real
// gravity and contact. No MuJoCo type appears in this header — only
// physics_object.cpp includes <mujoco/mujoco.h>, so nothing else in the
// engine needs to see it or its C++20 requirement.
// Units: meters, seconds, matching the rest of the engine.

namespace okrobo {

struct PhysicsObjectConfig {
    double half_extent = 0.03;  // a 6 cm cube
    double density = 1000.0;    // kg/m^3
    double start_x = 0.30;
    double start_y = 0.0;
    // Resting height on the floor (z=0 is the floor); reachable by the
    // default ArmConfig's joint limits with room to spare — verified
    // numerically, not assumed (see build.md).
    double start_z = 0.03;
};

struct Vec3 {
    double x = 0.0;
    double y = 0.0;
    double z = 0.0;
};

class PhysicsObject {
public:
    explicit PhysicsObject(const PhysicsObjectConfig& config = PhysicsObjectConfig{});
    ~PhysicsObject();
    PhysicsObject(const PhysicsObject&) = delete;
    PhysicsObject& operator=(const PhysicsObject&) = delete;

    /** Back to its start position, held, at rest. */
    void reset();

    /** Pin the object at `pos` with no simulation (used while held). */
    void set_kinematic(const Vec3& pos);

    /** Hand control to MuJoCo: a free body from `pos`, initial velocity zero. */
    void release(const Vec3& pos);

    /** Advance the physics by dt. A no-op while kinematically held. */
    void step(double dt);

    /** Current position: the pinned position while held, MuJoCo's while free. */
    Vec3 position() const;

    /** True once a released object has essentially stopped moving. */
    bool settled() const;

    bool held() const { return held_; }

private:
    PhysicsObjectConfig config_;
    struct Impl;
    Impl* impl_;
    bool held_ = true;
    Vec3 pinned_pos_;
};

}  // namespace okrobo
