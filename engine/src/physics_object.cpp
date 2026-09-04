#include "physics_object.hpp"

#include <algorithm>
#include <cmath>
#include <sstream>
#include <stdexcept>
#include <string>

#include <mujoco/mujoco.h>

namespace okrobo {

namespace {

constexpr double kModelTimestep = 0.002;  // proven stable in the WASM spike
constexpr double kSettleVelocity = 1e-3;  // m/s

std::string BuildMjcf(const PhysicsObjectConfig& config) {
    std::ostringstream xml;
    xml << "<mujoco model=\"okrobo_object\">"
        << "<option timestep=\"" << kModelTimestep << "\" gravity=\"0 0 -9.81\"/>"
        << "<worldbody>"
        << "<geom name=\"floor\" type=\"plane\" size=\"5 5 0.1\"/>"
        << "<body name=\"object\" pos=\"" << config.start_x << " " << config.start_y << " "
        << config.start_z << "\">"
        << "<freejoint/>"
        << "<geom name=\"objectgeom\" type=\"box\" size=\"" << config.half_extent << " "
        << config.half_extent << " " << config.half_extent << "\" density=\"" << config.density
        << "\"/>"
        << "</body>"
        << "</worldbody>"
        << "</mujoco>";
    return xml.str();
}

}  // namespace

struct PhysicsObject::Impl {
    mjSpec* spec = nullptr;
    mjModel* model = nullptr;
    mjData* data = nullptr;

    ~Impl() {
        if (data) mj_deleteData(data);
        if (model) mj_deleteModel(model);
        if (spec) mj_deleteSpec(spec);
    }
};

PhysicsObject::PhysicsObject(const PhysicsObjectConfig& config) : config_(config), impl_(new Impl) {
    const std::string xml = BuildMjcf(config_);
    char error[1024] = {0};
    impl_->spec = mj_parseXMLString(xml.c_str(), nullptr, error, sizeof(error));
    if (!impl_->spec) {
        throw std::runtime_error(std::string("physics object model failed to parse: ") + error);
    }
    impl_->model = mj_compile(impl_->spec, nullptr);
    if (!impl_->model) {
        throw std::runtime_error(std::string("physics object model failed to compile: ") +
                                  mjs_getError(impl_->spec));
    }
    impl_->data = mj_makeData(impl_->model);
    reset();
}

PhysicsObject::~PhysicsObject() { delete impl_; }

void PhysicsObject::reset() {
    held_ = true;
    pinned_pos_ = {config_.start_x, config_.start_y, config_.start_z};
}

void PhysicsObject::set_kinematic(const PhysicsVec3& pos) {
    held_ = true;
    pinned_pos_ = pos;
}

void PhysicsObject::release(const PhysicsVec3& pos) {
    held_ = false;
    mjData* d = impl_->data;
    d->qpos[0] = pos.x;
    d->qpos[1] = pos.y;
    d->qpos[2] = pos.z;
    // Identity quaternion: the object starts axis-aligned, not tumbling.
    d->qpos[3] = 1.0;
    d->qpos[4] = 0.0;
    d->qpos[5] = 0.0;
    d->qpos[6] = 0.0;
    for (int i = 0; i < impl_->model->nv; ++i) d->qvel[i] = 0.0;
    mj_forward(impl_->model, d);
}

void PhysicsObject::step(double dt) {
    if (held_ || dt <= 0.0) return;
    const int steps = std::max(1, static_cast<int>(std::lround(dt / kModelTimestep)));
    for (int i = 0; i < steps; ++i) {
        mj_step(impl_->model, impl_->data);
    }
}

PhysicsVec3 PhysicsObject::position() const {
    if (held_) return pinned_pos_;
    const mjData* d = impl_->data;
    return {d->qpos[0], d->qpos[1], d->qpos[2]};
}

bool PhysicsObject::settled() const {
    if (held_) return true;
    const mjData* d = impl_->data;
    const double speed = std::sqrt(d->qvel[0] * d->qvel[0] + d->qvel[1] * d->qvel[1] +
                                    d->qvel[2] * d->qvel[2]);
    return speed < kSettleVelocity && d->ncon > 0;
}

}  // namespace okrobo
