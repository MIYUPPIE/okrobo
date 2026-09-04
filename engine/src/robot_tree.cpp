#include "robot_tree.hpp"

#include <unordered_set>

namespace okrobo {

KinematicTree BuildKinematicTree(const RobotDef& robot) {
    // Dedup bodies/joints by id (first occurrence wins), mirroring
    // ValidateRobotDef and robotTree.ts exactly.
    std::unordered_map<std::string, const Body*> body_by_id;
    std::vector<std::string> body_order;
    for (const auto& body : robot.bodies) {
        if (body_by_id.count(body.id)) continue;
        body_by_id[body.id] = &body;
        body_order.push_back(body.id);
    }

    std::unordered_map<std::string, const Joint*> joint_by_id;
    std::vector<std::string> joint_order;
    for (const auto& joint : robot.joints) {
        if (joint_by_id.count(joint.id)) continue;
        joint_by_id[joint.id] = &joint;
        joint_order.push_back(joint.id);
    }

    // Group by child, excluding self-loops and joints whose child doesn't
    // resolve to a real body -- matches ValidateRobotDef's tree-edge rules.
    std::unordered_map<std::string, std::vector<const Joint*>> child_joints;
    std::vector<std::string> child_order;
    for (const auto& joint_id : joint_order) {
        const Joint& joint = *joint_by_id.at(joint_id);
        if (joint.parent == joint.child) continue;
        if (!body_by_id.count(joint.child)) continue;
        if (!child_joints.count(joint.child)) child_order.push_back(joint.child);
        child_joints[joint.child].push_back(&joint);
    }

    KinematicTree tree;
    for (const auto& child_id : child_order) {
        const Joint* first = child_joints.at(child_id).front();
        tree.parent_of[child_id] = first->parent;
        tree.parent_joint_of[child_id] = first;
    }

    for (const auto& body_id : body_order) {
        if (!tree.parent_of.count(body_id)) tree.root_ids.push_back(body_id);
    }

    // Iterate child_order (deterministic, joint-declaration order), not
    // tree.parent_of directly (an unordered_map) -- keeps children_of's
    // per-parent ordering deterministic, matching robotTree.ts's Map
    // insertion-order iteration.
    for (const auto& child_id : child_order) {
        const std::string& parent_id = tree.parent_of.at(child_id);
        if (!body_by_id.count(parent_id)) continue;  // parent id doesn't resolve; no tree edge to walk
        tree.children_of[parent_id].push_back(child_id);
    }

    std::unordered_set<std::string> reachable;
    std::vector<std::string> stack(tree.root_ids.begin(), tree.root_ids.end());
    while (!stack.empty()) {
        std::string id = stack.back();
        stack.pop_back();
        if (reachable.count(id)) continue;
        reachable.insert(id);
        auto it = tree.children_of.find(id);
        if (it != tree.children_of.end()) {
            for (const auto& child : it->second) stack.push_back(child);
        }
    }
    for (const auto& body_id : body_order) {
        if (!reachable.count(body_id)) tree.unreachable_ids.push_back(body_id);
    }

    return tree;
}

}  // namespace okrobo
