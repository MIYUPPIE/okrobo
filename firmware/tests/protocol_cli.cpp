// Feeds stdin through the firmware's real parser and prints what the board
// would understand, so the Python side can be checked against it
// (runtime/python/tests/test_serial_parity.py). Same idea as the simulator's
// parity gate: two implementations of one contract, locked together.
//
// Output per input line, one of:
//   HELLO | STOP | RESET | QUERY | NONE | ERROR
//   DRIVE <left> <right>      (6 decimals, as parsed by the board)

#include "protocol.hpp"

#include <cstdio>
#include <iostream>
#include <string>

int main() {
    std::string line;
    while (std::getline(std::cin, line)) {
        // Route the bytes through the board's own line reader first.
        okrobo::LineReader reader;
        const char* complete = nullptr;
        for (char c : line) {
            const char* result = reader.feed(c);
            if (result) complete = result;
        }
        const char* result = reader.feed('\n');
        if (result) complete = result;
        if (!complete) {
            std::puts("NONE");
            continue;
        }

        const okrobo::Command command = okrobo::parse_command(complete);
        switch (command.type) {
            case okrobo::CommandType::Hello:
                std::puts("HELLO");
                break;
            case okrobo::CommandType::Stop:
                std::puts("STOP");
                break;
            case okrobo::CommandType::Reset:
                std::puts("RESET");
                break;
            case okrobo::CommandType::Query:
                std::puts("QUERY");
                break;
            case okrobo::CommandType::Drive:
                std::printf("DRIVE %.6f %.6f\n", static_cast<double>(command.left),
                            static_cast<double>(command.right));
                break;
            case okrobo::CommandType::Error:
                std::puts("ERROR");
                break;
            case okrobo::CommandType::None:
                std::puts("NONE");
                break;
        }
        std::fflush(stdout);
    }
    return 0;
}
