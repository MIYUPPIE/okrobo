#pragma once

// Kinematic tree derived from a RobotDef's joints[] edges. Mirrors (does not
// re-derive differently) ValidateRobotDef's dedup + first-edge-wins graph
// logic (contracts/robot-def/v0/contract.md) so the two can't silently drift
// apart -- cross-checked in test_robot_tree.cpp against ValidateRobotDef's
// own issues on the same documents. A line-for-line port of
// apps/studio/src/builder/robotTree.ts (Robot Builder Phase 2's TS mirror of
// this same logic) -- keep the two in sync by inspection, the same way
// robot_def.py/robotDef.ts/robot_def.cpp are kept in sync for the contract
// itself. Deliberately not added to the frozen okrobo_robot_def target (see
// contracts/robot-def/v0/contract.md's "frozen" note) -- its own target.

#include "robot_def.hpp"

#include <string>
#include <unordered_map>
#include <vector>

namespace okrobo {

struct KinematicTree {
    /// Bodies with no incoming joint edge, in bodies[] declaration order.
    std::vector<std::string> root_ids;
    /// child body id -> parent body id (first joint wins per child).
    std::unordered_map<std::string, std::string> parent_of;
    /// child body id -> the joint that attaches it (first joint wins per
    /// child). Points into the RobotDef passed to BuildKinematicTree; the
    /// caller must keep it alive for as long as this tree is used.
    std::unordered_map<std::string, const Joint*> parent_joint_of;
    /// parent body id -> ordered child body ids (only edges whose parent
    /// resolves to a real body).
    std::unordered_map<std::string, std::vector<std::string>> children_of;
    /// Bodies not reachable from any root -- a joint cycle, or an orphan
    /// whose recorded parent id doesn't resolve to a real body. Still real
    /// bodies: a renderer or generator should still account for them
    /// rather than silently dropping them.
    std::vector<std::string> unreachable_ids;
};

KinematicTree BuildKinematicTree(const RobotDef& robot);

}  // namespace okrobo
