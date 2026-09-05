#include "world_def.hpp"

#include <nlohmann/json.hpp>

#include <stdexcept>
#include <unordered_set>

namespace okrobo {

namespace {

using nlohmann::json;

// Small, deliberately duplicated copy of robot_def.cpp's own Transform/
// Geometry JSON parsing and serialization: those helpers have internal
// linkage (anonymous namespace) and are genuinely unreachable from this
// translation unit, not merely unexported. See
// docs/decisions/robot-builder-world.md.

Vec3 ParseVec3(const json& value, const std::string& context) {
    if (!value.is_array() || value.size() != 3) {
        throw std::runtime_error("world-def: " + context + " must be three numbers");
    }
    return Vec3{value[0].get<double>(), value[1].get<double>(), value[2].get<double>()};
}

Transform ParseTransform(const json& data) {
    Transform t{};
    if (data.is_null()) return t;
    if (data.contains("position")) t.position = ParseVec3(data.at("position"), "transform.position");
    if (data.contains("rotation_rpy")) t.rotation_rpy = ParseVec3(data.at("rotation_rpy"), "transform.rotation_rpy");
    return t;
}

Geometry ParseGeometry(const json& data) {
    Geometry g{};
    const std::string type = data.at("type").get<std::string>();
    if (type == "box") {
        g.type = GeometryType::kBox;
        g.size = ParseVec3(data.at("size"), "geometry.size");
    } else if (type == "sphere") {
        g.type = GeometryType::kSphere;
        g.radius = data.at("radius").get<double>();
    } else if (type == "cylinder" || type == "capsule" || type == "cone") {
        g.type = type == "cylinder" ? GeometryType::kCylinder : (type == "capsule" ? GeometryType::kCapsule : GeometryType::kCone);
        g.radius = data.at("radius").get<double>();
        g.length = data.at("length").get<double>();
    } else if (type == "plane") {
        g.type = GeometryType::kPlane;
        const auto& size = data.at("size");
        if (!size.is_array() || size.size() != 2) throw std::runtime_error("world-def: plane geometry needs a two-number size");
        g.size = Vec3{size[0].get<double>(), size[1].get<double>(), 0.0};
    } else if (type == "mesh") {
        g.type = GeometryType::kMesh;
        g.path = data.at("path").get<std::string>();
        g.scale = data.contains("scale") ? ParseVec3(data.at("scale"), "geometry.scale") : Vec3{1.0, 1.0, 1.0};
    } else if (type == "cad_mesh") {
        g.type = GeometryType::kCadMesh;
        const auto& vertices = data.at("vertices");
        if (!vertices.is_array()) throw std::runtime_error("world-def: cad_mesh geometry needs a numeric vertices array");
        for (const auto& v : vertices) g.vertices.push_back(v.get<double>());
        const auto& faces = data.at("faces");
        if (!faces.is_array()) throw std::runtime_error("world-def: cad_mesh geometry needs an integer faces array");
        for (const auto& f : faces) {
            if (!f.is_number_integer() || f.get<int64_t>() < 0) {
                throw std::runtime_error("world-def: cad_mesh geometry needs a non-negative integer faces array");
            }
            g.faces.push_back(f.get<int32_t>());
        }
    } else {
        throw std::runtime_error("world-def: unknown geometry type '" + type + "'");
    }
    return g;
}

Material ParseMaterial(const json& data) {
    Material m{};
    if (data.is_null()) return m;
    if (data.contains("color")) {
        m.has_color = true;
        for (const auto& c : data.at("color")) m.color.push_back(c.get<double>());
    }
    return m;
}

WorldObject ParseWorldObject(const json& data) {
    WorldObject o{};
    o.id = data.at("id").get<std::string>();
    o.name = data.at("name").get<std::string>();
    o.transform = data.contains("transform") ? ParseTransform(data.at("transform")) : Transform{};
    if (!data.contains("geometry")) throw std::runtime_error("world-def: object '" + o.id + "' needs geometry");
    o.geometry = ParseGeometry(data.at("geometry"));
    o.material = data.contains("material") ? ParseMaterial(data.at("material")) : Material{};
    return o;
}

json TransformToJson(const Transform& t) {
    return json{{"position", {t.position.x, t.position.y, t.position.z}}, {"rotation_rpy", {t.rotation_rpy.x, t.rotation_rpy.y, t.rotation_rpy.z}}};
}

json GeometryToJson(const Geometry& g) {
    switch (g.type) {
        case GeometryType::kBox:
            return json{{"type", "box"}, {"size", {g.size.x, g.size.y, g.size.z}}};
        case GeometryType::kSphere:
            return json{{"type", "sphere"}, {"radius", g.radius}};
        case GeometryType::kCylinder:
            return json{{"type", "cylinder"}, {"radius", g.radius}, {"length", g.length}};
        case GeometryType::kCapsule:
            return json{{"type", "capsule"}, {"radius", g.radius}, {"length", g.length}};
        case GeometryType::kCone:
            return json{{"type", "cone"}, {"radius", g.radius}, {"length", g.length}};
        case GeometryType::kPlane:
            return json{{"type", "plane"}, {"size", {g.size.x, g.size.y}}};
        case GeometryType::kMesh:
            return json{{"type", "mesh"}, {"path", g.path}, {"scale", {g.scale.x, g.scale.y, g.scale.z}}};
        case GeometryType::kCadMesh:
            return json{{"type", "cad_mesh"}, {"vertices", g.vertices}, {"faces", g.faces}};
    }
    throw std::runtime_error("world-def: unknown geometry type");
}

json ObjectToJson(const WorldObject& o) {
    json out{{"id", o.id}, {"name", o.name}, {"transform", TransformToJson(o.transform)}, {"geometry", GeometryToJson(o.geometry)}};
    if (o.material.has_color) out["material"] = json{{"color", o.material.color}};
    return out;
}

bool GeometryIsValid(const Geometry& g) {
    switch (g.type) {
        case GeometryType::kBox:
            return g.size.x > 0 && g.size.y > 0 && g.size.z > 0;
        case GeometryType::kPlane:
            return g.size.x > 0 && g.size.y > 0;
        case GeometryType::kSphere:
            return g.radius > 0;
        case GeometryType::kCylinder:
        case GeometryType::kCapsule:
        case GeometryType::kCone:
            return g.radius > 0 && g.length > 0;
        case GeometryType::kMesh:
            return !g.path.empty();
        case GeometryType::kCadMesh:
            if (g.vertices.empty() || g.vertices.size() % 3 != 0 || g.faces.empty() || g.faces.size() % 3 != 0) return false;
            for (const auto& index : g.faces) {
                if (static_cast<size_t>(index) >= g.vertices.size() / 3) return false;
            }
            return true;
    }
    return true;
}

}  // namespace

WorldDef ParseWorldDef(const std::string& text) {
    json data;
    try {
        data = json::parse(text);
    } catch (const json::parse_error& e) {
        throw std::runtime_error(std::string("world-def: invalid JSON: ") + e.what());
    }
    if (!data.contains("id") || !data.contains("name") || !data.contains("objects")) {
        throw std::runtime_error("world-def: missing required field 'id', 'name', or 'objects'");
    }

    WorldDef world{};
    world.id = data.at("id").get<std::string>();
    world.name = data.at("name").get<std::string>();
    world.description = data.value("description", std::string{});
    for (const auto& o : data.at("objects")) world.objects.push_back(ParseWorldObject(o));
    return world;
}

std::string WorldDefToJson(const WorldDef& world) {
    json objects = json::array();
    for (const auto& o : world.objects) objects.push_back(ObjectToJson(o));
    json out{{"id", world.id}, {"name", world.name}, {"description", world.description}, {"objects", objects}};
    return out.dump();
}

std::vector<ValidationIssue> ValidateWorldDef(const WorldDef& world) {
    std::vector<ValidationIssue> issues;
    std::unordered_set<std::string> seen_ids;

    for (const auto& object : world.objects) {
        if (seen_ids.count(object.id)) {
            issues.push_back(ValidationIssue{"object-duplicate-id", "error", "object", object.id, "Duplicate object id '" + object.id + "'"});
        } else {
            seen_ids.insert(object.id);
        }

        if (!GeometryIsValid(object.geometry)) {
            issues.push_back(ValidationIssue{"object-invalid-geometry", "error", "object", object.id,
                                              "Object '" + object.id + "': geometry size must be positive"});
        }
    }

    return issues;
}

}  // namespace okrobo
