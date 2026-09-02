#pragma once

// OKROBO serial protocol (contracts/robot-serial/v0), board side.
//
// Header-only, no allocation, no Arduino dependency: the .ino includes this
// and so do the host tests, which is how firmware parsing gets gate-tested on
// a workstation without a board attached. Keep it free of Arduino APIs.

#include <stddef.h>
#include <stdint.h>

namespace okrobo {

constexpr size_t kMaxLine = 64;

enum class CommandType { None, Hello, Drive, Stop, Reset, Query, Error };

struct Command {
    CommandType type = CommandType::None;
    float left = 0.0f;   // m/s, Drive only
    float right = 0.0f;  // m/s, Drive only
};

struct BoardState {
    uint32_t tick = 0;
    float x = 0.0f;
    float y = 0.0f;
    float theta = 0.0f;
    float distance = 0.0f;
    bool collided = false;
};

namespace detail {

inline bool is_space(char c) { return c == ' ' || c == '\t'; }

inline const char* skip_spaces(const char* p) {
    while (*p && is_space(*p)) ++p;
    return p;
}

// Minimal decimal float parser: [-]digits[.digits]. No exponents, no locale.
// Returns false when the text is not a complete number.
inline bool parse_float(const char*& p, float& out) {
    p = skip_spaces(p);
    if (!*p) return false;
    bool negative = false;
    if (*p == '-' || *p == '+') {
        negative = (*p == '-');
        ++p;
    }
    if (*p < '0' || *p > '9') return false;

    float value = 0.0f;
    while (*p >= '0' && *p <= '9') {
        value = value * 10.0f + static_cast<float>(*p - '0');
        ++p;
    }
    if (*p == '.') {
        ++p;
        float scale = 0.1f;
        if (*p < '0' || *p > '9') return false;
        while (*p >= '0' && *p <= '9') {
            value += static_cast<float>(*p - '0') * scale;
            scale *= 0.1f;
            ++p;
        }
    }
    if (*p && !is_space(*p)) return false;  // trailing junk
    out = negative ? -value : value;
    return true;
}

inline void append(char* out, size_t capacity, size_t& length, char c) {
    if (length + 1 < capacity) out[length++] = c;
}

// Fixed-point formatting: value with `decimals` places, no printf, no float
// formatting in libc (many microcontroller libcs omit %f entirely).
inline void append_float(char* out, size_t capacity, size_t& length, float value, int decimals) {
    if (value < 0) {
        append(out, capacity, length, '-');
        value = -value;
    }
    float rounding = 0.5f;
    for (int i = 0; i < decimals; ++i) rounding *= 0.1f;
    value += rounding;

    uint32_t whole = static_cast<uint32_t>(value);
    char digits[12];
    int count = 0;
    if (whole == 0) {
        digits[count++] = '0';
    } else {
        while (whole > 0 && count < 12) {
            digits[count++] = static_cast<char>('0' + (whole % 10));
            whole /= 10;
        }
    }
    while (count > 0) append(out, capacity, length, digits[--count]);

    if (decimals <= 0) return;
    append(out, capacity, length, '.');
    float fraction = value - static_cast<float>(static_cast<uint32_t>(value));
    for (int i = 0; i < decimals; ++i) {
        fraction *= 10.0f;
        int digit = static_cast<int>(fraction);
        if (digit < 0) digit = 0;
        if (digit > 9) digit = 9;
        append(out, capacity, length, static_cast<char>('0' + digit));
        fraction -= static_cast<float>(digit);
    }
}

inline void append_uint(char* out, size_t capacity, size_t& length, uint32_t value) {
    char digits[12];
    int count = 0;
    if (value == 0) {
        digits[count++] = '0';
    } else {
        while (value > 0 && count < 12) {
            digits[count++] = static_cast<char>('0' + (value % 10));
            value /= 10;
        }
    }
    while (count > 0) append(out, capacity, length, digits[--count]);
}

}  // namespace detail

/// Parse one line from the host. Never fails destructively: anything
/// unrecognised comes back as CommandType::Error so the board can reply and
/// carry on.
inline Command parse_command(const char* line) {
    Command command;
    if (!line) return command;
    const char* p = detail::skip_spaces(line);
    if (!*p) return command;  // blank line: nothing to do

    const char verb = *p++;
    switch (verb) {
        case 'H':
            command.type = CommandType::Hello;
            break;
        case 'S':
            command.type = CommandType::Stop;
            break;
        case 'R':
            command.type = CommandType::Reset;
            break;
        case 'Q':
            command.type = CommandType::Query;
            break;
        case 'D': {
            float left = 0.0f;
            float right = 0.0f;
            if (!detail::parse_float(p, left) || !detail::parse_float(p, right)) {
                command.type = CommandType::Error;
                return command;
            }
            command.type = CommandType::Drive;
            command.left = left;
            command.right = right;
            break;
        }
        default:
            command.type = CommandType::Error;
            return command;
    }

    // Verbs other than D take no arguments.
    if (command.type != CommandType::Drive && *detail::skip_spaces(p) != '\0') {
        command.type = CommandType::Error;
    }
    return command;
}

/// Format a state line: "T <tick> <x> <y> <theta> <distance> <collided>".
/// Returns the length written (always null-terminated).
inline size_t format_state(const BoardState& state, char* out, size_t capacity) {
    size_t length = 0;
    detail::append(out, capacity, length, 'T');
    detail::append(out, capacity, length, ' ');
    detail::append_uint(out, capacity, length, state.tick);
    detail::append(out, capacity, length, ' ');
    detail::append_float(out, capacity, length, state.x, 3);
    detail::append(out, capacity, length, ' ');
    detail::append_float(out, capacity, length, state.y, 3);
    detail::append(out, capacity, length, ' ');
    detail::append_float(out, capacity, length, state.theta, 4);
    detail::append(out, capacity, length, ' ');
    detail::append_float(out, capacity, length, state.distance, 3);
    detail::append(out, capacity, length, ' ');
    detail::append(out, capacity, length, state.collided ? '1' : '0');
    if (length < capacity) out[length] = '\0';
    return length;
}

/// Format the identity line: "I <name> <version>".
inline size_t format_identity(const char* name, uint32_t version, char* out, size_t capacity) {
    size_t length = 0;
    detail::append(out, capacity, length, 'I');
    detail::append(out, capacity, length, ' ');
    for (const char* p = name; p && *p; ++p) detail::append(out, capacity, length, *p);
    detail::append(out, capacity, length, ' ');
    detail::append_uint(out, capacity, length, version);
    if (length < capacity) out[length] = '\0';
    return length;
}

/// Accumulates incoming bytes and hands back complete lines.
class LineReader {
public:
    /// Feed one byte. Returns a pointer to a null-terminated line when the
    /// byte completed one, otherwise nullptr. Overlong lines are dropped
    /// rather than overflowing.
    const char* feed(char c) {
        if (c == '\r') return nullptr;
        if (c == '\n') {
            if (overflowed_) {  // discard the truncated remains
                length_ = 0;
                overflowed_ = false;
                return nullptr;
            }
            buffer_[length_] = '\0';
            length_ = 0;
            return buffer_;
        }
        if (length_ + 1 >= kMaxLine) {
            overflowed_ = true;
            return nullptr;
        }
        buffer_[length_++] = c;
        return nullptr;
    }

private:
    char buffer_[kMaxLine] = {};
    size_t length_ = 0;
    bool overflowed_ = false;
};

}  // namespace okrobo
