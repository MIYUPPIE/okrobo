// Gate tests for Arm.grip()/release(): the graspable object, real MuJoCo
// contact/gravity once released, kinematic follow while held. Joint targets
// below were found numerically (not hand-derived) against the default
// ArmConfig's forward kinematics — see build.md.

#include "arm_world.hpp"

#include <cassert>
#include <cmath>
#include <cstdio>

namespace {

constexpr double kPi = 3.14159265358979323846;

bool near(double a, double b, double tol = 1e-9) { return std::abs(a - b) < tol; }

void run(okrobo::ArmWorld& arm, double seconds, double dt = 0.01) {
    const int steps = static_cast<int>(std::round(seconds / dt));
    for (int i = 0; i < steps; ++i) arm.step(dt);
}

/** Drives the arm to a pose whose tip sits ~0.030 m from the object's
 *  default start (0.30, 0, 0.03) -- comfortably inside kGraspTolerance
 *  (0.05 m), found by a numeric search over the joint ranges. */
void reach_for_object(okrobo::ArmWorld& arm) {
    arm.set_target(1, 50.0 * kPi / 180.0);
    arm.set_target(2, -104.0 * kPi / 180.0);
    arm.set_target(3, -2.0 * kPi / 180.0);
    run(arm, 3.0);  // plenty of time to arrive
    assert(!arm.state().moving);
}

void test_object_starts_put_and_unheld_visibly() {
    okrobo::ArmWorld arm;
    const auto s = arm.state();
    assert(!s.holding);
    assert(near(s.object.x, 0.30));
    assert(near(s.object.y, 0.0));
    assert(near(s.object.z, 0.03));
}

void test_grip_fails_when_the_tip_is_far_away() {
    okrobo::ArmWorld arm;  // default start pose: tip is ~0.376 m from the object
    assert(!arm.grip());
    assert(!arm.state().holding);
}

void test_grip_succeeds_within_tolerance_and_object_tracks_the_tip() {
    okrobo::ArmWorld arm;
    reach_for_object(arm);
    assert(arm.grip());
    auto s = arm.state();
    assert(s.holding);
    assert(near(s.object.x, s.tip.x, 1e-9));
    assert(near(s.object.z, s.tip.z, 1e-9));

    // Move the arm elsewhere while holding: the object must follow exactly.
    arm.set_target(0, kPi / 4);  // swing the base
    run(arm, 1.0);
    s = arm.state();
    assert(s.holding);
    assert(near(s.object.x, s.tip.x, 1e-9));
    assert(near(s.object.y, s.tip.y, 1e-9));
    assert(near(s.object.z, s.tip.z, 1e-9));
    // It actually moved with the base swing, not stayed at the old spot.
    assert(std::abs(s.object.y) > 0.05);
}

void test_release_drops_the_object_and_it_settles_under_real_gravity() {
    okrobo::ArmWorld arm;
    reach_for_object(arm);
    assert(arm.grip());
    const double held_z = arm.state().object.z;  // ~0.060

    arm.release();
    assert(!arm.state().holding);

    run(arm, 1.0);
    const auto mid = arm.state();
    run(arm, 0.5);
    const auto final_state = arm.state();

    // It actually fell (not still pinned at the grip height)...
    assert(final_state.object.z < held_z - 0.01);
    // ...and settled at the box's half-extent (resting on the floor)...
    assert(near(final_state.object.z, 0.03, 5e-3));
    // ...and stayed there (no bouncing/drift still happening at t=1.5s).
    assert(near(mid.object.z, final_state.object.z, 2e-3));
    assert(near(mid.object.x, final_state.object.x, 2e-3));
    assert(near(mid.object.y, final_state.object.y, 2e-3));
    // No lateral drift from a straight vertical drop.
    assert(near(final_state.object.x, 0.30, 5e-3));
    assert(near(final_state.object.y, 0.0, 5e-3));
}

void test_release_without_holding_is_a_harmless_no_op() {
    okrobo::ArmWorld arm;
    arm.release();  // never gripped anything
    const auto s = arm.state();
    assert(!s.holding);
    assert(near(s.object.z, 0.03));
}

void test_reset_returns_the_object_and_releases_the_hold() {
    okrobo::ArmWorld arm;
    reach_for_object(arm);
    assert(arm.grip());
    arm.release();
    run(arm, 1.0);  // let it fall away from the start position

    arm.reset();
    const auto s = arm.state();
    assert(!s.holding);
    assert(near(s.object.x, 0.30));
    assert(near(s.object.y, 0.0));
    assert(near(s.object.z, 0.03));
    assert(s.tick == 0);
}

}  // namespace

int main() {
    test_object_starts_put_and_unheld_visibly();
    test_grip_fails_when_the_tip_is_far_away();
    test_grip_succeeds_within_tolerance_and_object_tracks_the_tip();
    test_release_drops_the_object_and_it_settles_under_real_gravity();
    test_release_without_holding_is_a_harmless_no_op();
    test_reset_returns_the_object_and_releases_the_hold();
    std::puts("engine arm physics: all tests passed");
    return 0;
}
