// Gate tests for the firmware's serial protocol (contracts/robot-serial/v0).
// This is the exact code that runs on the board, tested on a workstation so
// firmware bugs are caught without flashing hardware.

#include "protocol.hpp"

#include <cassert>
#include <cmath>
#include <cstdio>
#include <cstring>

namespace {

using okrobo::CommandType;

bool near(float a, float b, float tol = 1e-4f) { return std::fabs(a - b) < tol; }

void test_simple_verbs() {
    assert(okrobo::parse_command("H").type == CommandType::Hello);
    assert(okrobo::parse_command("S").type == CommandType::Stop);
    assert(okrobo::parse_command("R").type == CommandType::Reset);
    assert(okrobo::parse_command("Q").type == CommandType::Query);
    // Leading whitespace is tolerated.
    assert(okrobo::parse_command("  Q").type == CommandType::Query);
    // A blank line is not an error, just nothing.
    assert(okrobo::parse_command("").type == CommandType::None);
    assert(okrobo::parse_command("   ").type == CommandType::None);
}

void test_drive_parsing() {
    auto command = okrobo::parse_command("D 0.200 -0.150");
    assert(command.type == CommandType::Drive);
    assert(near(command.left, 0.2f));
    assert(near(command.right, -0.15f));

    command = okrobo::parse_command("D 0 0");
    assert(command.type == CommandType::Drive);
    assert(near(command.left, 0.0f));
    assert(near(command.right, 0.0f));

    // Extra spacing is fine.
    command = okrobo::parse_command("D   1.5    2.25  ");
    assert(command.type == CommandType::Drive);
    assert(near(command.left, 1.5f));
    assert(near(command.right, 2.25f));
}

void test_malformed_lines_are_errors_not_crashes() {
    assert(okrobo::parse_command("D").type == CommandType::Error);
    assert(okrobo::parse_command("D 0.2").type == CommandType::Error);
    assert(okrobo::parse_command("D abc def").type == CommandType::Error);
    assert(okrobo::parse_command("D 0.2 xyz").type == CommandType::Error);
    assert(okrobo::parse_command("D 1.2.3 0").type == CommandType::Error);
    assert(okrobo::parse_command("X").type == CommandType::Error);
    assert(okrobo::parse_command("HELLO").type == CommandType::Error);
    assert(okrobo::parse_command("Q 5").type == CommandType::Error);
    assert(okrobo::parse_command(nullptr).type == CommandType::None);
}

void test_state_formatting() {
    okrobo::BoardState state;
    state.tick = 1234;
    state.x = 1.25f;
    state.y = -0.5f;
    state.theta = 1.5708f;
    state.distance = 0.9f;
    state.collided = true;

    char line[okrobo::kMaxLine];
    const size_t length = okrobo::format_state(state, line, sizeof(line));
    assert(length > 0 && length < okrobo::kMaxLine);
    assert(std::strcmp(line, "T 1234 1.250 -0.500 1.5708 0.900 1") == 0);

    okrobo::BoardState zero;
    okrobo::format_state(zero, line, sizeof(line));
    assert(std::strcmp(line, "T 0 0.000 0.000 0.0000 0.000 0") == 0);
}

void test_identity_formatting() {
    char line[okrobo::kMaxLine];
    okrobo::format_identity("okrobo-car", 1, line, sizeof(line));
    assert(std::strcmp(line, "I okrobo-car 1") == 0);
}

void test_line_reader() {
    okrobo::LineReader reader;
    const char* line = nullptr;
    for (const char* p = "D 0.1 0.2\n"; *p; ++p) {
        const char* completed = reader.feed(*p);
        if (completed) line = completed;
    }
    assert(line != nullptr);
    assert(std::strcmp(line, "D 0.1 0.2") == 0);

    // CRLF from a serial monitor must not corrupt the line.
    okrobo::LineReader crlf;
    line = nullptr;
    for (const char* p = "Q\r\n"; *p; ++p) {
        const char* completed = crlf.feed(*p);
        if (completed) line = completed;
    }
    assert(line != nullptr && std::strcmp(line, "Q") == 0);
}

void test_line_reader_survives_overlong_input() {
    okrobo::LineReader reader;
    // 200 bytes of junk with no newline must not overflow the 64-byte buffer.
    for (int i = 0; i < 200; ++i) assert(reader.feed('A') == nullptr);
    assert(reader.feed('\n') == nullptr);  // the truncated line is dropped

    // The reader keeps working afterwards.
    const char* line = nullptr;
    for (const char* p = "S\n"; *p; ++p) {
        const char* completed = reader.feed(*p);
        if (completed) line = completed;
    }
    assert(line != nullptr && std::strcmp(line, "S") == 0);
}

}  // namespace

int main() {
    test_simple_verbs();
    test_drive_parsing();
    test_malformed_lines_are_errors_not_crashes();
    test_state_formatting();
    test_identity_formatting();
    test_line_reader();
    test_line_reader_survives_overlong_input();
    std::puts("firmware protocol: all tests passed");
    return 0;
}
