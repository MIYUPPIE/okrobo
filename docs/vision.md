> Original vision notes for OKROBO, kept verbatim. The actionable plan lives in [build.md](../build.md).

WEB APP NAME: OKROBO

### The key distinction

You don't want:

> "A website that can simulate robots."

You want:

> **"A local robotics development environment with a browser-like interface, capable of working completely offline."**

Something between:

* Webots
* VS Code
* Tinkercad
* Scratch
* a robotics simulator
* an educational IDE

---

# The architecture I'd recommend

```text
                  OKHUB ROBOTICS STUDIO
                         DESKTOP APP
                              │
                 ┌────────────┴────────────┐
                 │                         │
             WEB UI                    NATIVE CORE
                 │                         │
        TypeScript / React               C++
                 │                         │
        ┌────────┼─────────┐       ┌──────┼─────────┐
        │        │         │       │      │         │
      Blockly  Python    Monaco   Physics Renderer ROS 2
        │        │         │       │      │         │
        └────────┼─────────┘       └──────┼─────────┘
                 │                         │
                 └───────────┬─────────────┘
                             │
                       ROBOT API
                             │
                ┌────────────┼────────────┐
                │            │            │
             Simulator     Devices       AI
                │            │            │
             Virtual       ESP32       Local AI
             Robot        Arduino      Models
                           Raspberry Pi
```

And the entire thing runs **locally**.

---

# I would use these three languages exactly

## TypeScript — the interface

This is your primary UI language.

Use it for:

* interface
* 3D editor
* menus
* project management
* Blockly
* code editor
* visual programming
* dashboards
* robot configuration
* animations
* lesson interface

For example:

```text
React
   ↓
TypeScript
   ↓
Three.js/Babylon.js
   ↓
WebGPU/WebGL
```

This gives you the "browser" experience.

---

# Python — education + robotics + AI

Students can write:

```python
robot.forward()

if robot.distance() < 20:
    robot.turn_left()
```

Python can also be used for:

* AI
* computer vision
* machine learning
* robotics algorithms
* data science
* automation

And importantly, Python can run **locally**.

You don't want:

```text
Student
 ↓
Internet
 ↓
Cloud Python server
 ↓
Execute code
 ↓
Internet
 ↓
Result
```

You want:

```text
Student
 ↓
Local Python runtime
 ↓
Robot
```

---

# C++ — the engine

This should handle the expensive parts.

For example:

```text
C++
│
├── Physics
├── Robot dynamics
├── Collision detection
├── Sensors
├── Motors
├── Path planning
├── Simulation
├── Hardware communication
├── ROS 2
└── Performance-critical AI
```

TypeScript doesn't need to know how the physics works.

It just says:

```text
robot.moveForward()
```

The C++ engine handles the actual simulation.

---

# The important part: don't make the browser itself the application

I'd strongly consider:

## Electron or, preferably, Tauri

Your application would essentially be:

```text
┌─────────────────────────────────────────┐
│ OKHUB Robotics Studio                   │
├─────────────────────────────────────────┤
│ File   Edit   Robot   Simulation   Help  │
├─────────────┬───────────────────────────┤
│             │                           │
│ ROBOTS      │                           │
│             │       3D WORLD            │
│ 🚗 Car      │                           │
│ 🦾 Arm      │          🤖               │
│ 🛸 Drone    │                           │
│             │                           │
│             │                           │
├─────────────┴───────────────────────────┤
│ BLOCKS / PYTHON / C++ / TYPESCRIPT      │
│                                         │
│ [ WHEN START ] → [ MOVE ] → [ STOP ]   │
│                                         │
├─────────────────────────────────────────┤
│ ▶ RUN    ⏹ STOP    🔄 RESET            │
└─────────────────────────────────────────┘
```

It **looks like a website**.

But it is actually a desktop application.

---

# Why Tauri is particularly interesting

Tauri gives you:

```text
Frontend
TypeScript / React
       ↓
     Tauri
       ↓
Rust/native layer
       ↓
Operating system
```

But since you're interested in **C++**, you can have a native C++ simulation engine alongside it.

For example:

```text
                 Tauri
                   │
             TypeScript UI
                   │
              IPC/WebSocket
                   │
             C++ Engine
                   │
       ┌───────────┼────────────┐
       ↓           ↓            ↓
    Physics     Sensors       Motors
```

You could also use a C++ library directly through a native bridge depending on the architecture.

---

# Offline should be a first-class feature

I would design the system around:

> **Offline by default.**

When the application starts:

```text
Internet: ❌

OKHUB Robotics Studio
       ↓
Everything works
```

Students can:

* create projects
* program
* simulate
* learn lessons
* run Python
* run C++
* build robots
* save projects
* use sensors
* use AI models that are installed locally

No internet required.

---

# Then create an "Asset Store"

This solves your large-file problem beautifully.

Suppose the basic installation is:

### OKHUB Robotics Studio

```text
Application              300 MB
Core simulator           500 MB
Blockly                   20 MB
Python runtime            50 MB
Basic robot models        30 MB
Basic lessons             20 MB
────────────────────────────────
                         ~920 MB
```

Then optional content:

```text
Robotics Pack
├── TurtleBot
├── LiDAR
├── Camera
└── ROS 2 environment

~1.5 GB
```

The student clicks:

> **Download Robotics Pack**

Only then does the application connect to the internet.

---

# You can make "packs"

This is probably the best approach for your target schools.

### Core Pack

Installed automatically.

```text
🧱 Blockly
🐍 Python
💻 C++
🟦 TypeScript
🤖 Basic Robot
📡 Basic Sensors
🌎 Basic Worlds
```

### Robotics Pack

```text
🚗 Advanced robots
🦾 Robotic arms
🛞 Differential drive
📡 LiDAR
📷 Cameras
🧭 IMU
```

### ROS 2 Pack

```text
ROS 2
URDF
TF
Topics
Services
Actions
Navigation
```

### AI Pack

```text
OpenCV
YOLO
PyTorch
Local models
Computer vision
Speech models
```

### IoT Pack

```text
ESP32
Arduino
MQTT
Raspberry Pi
Web Serial
WebUSB
```

---

# This is particularly powerful for schools

Imagine a school with poor or unreliable internet.

You install:

> **OKHUB Robotics Studio**

on 30 computers.

After installation:

```text
INTERNET
   │
   └── Only needed for:
       • Updates
       • New lessons
       • Asset downloads
       • AI model downloads
       • Cloud synchronization
```

Everything else happens locally.

That is a **major advantage in environments where internet access is inconsistent or expensive**.

---

# You could even have a school server

This gets even better.

Instead of every computer downloading a 2 GB robotics package:

```text
             SCHOOL SERVER
                   │
        ┌──────────┼──────────┐
        ↓          ↓          ↓
     Student 1  Student 2  Student 30
```

The server stores:

```text
Robots
Textures
Worlds
Lessons
AI models
Python packages
ROS 2 packages
```

Students download them through the school's **local network**.

Internet isn't required.

---

# And your application can eventually become a real robotics OS

This is where I think your idea becomes much bigger than Webots.

You could have:

```text
                 OKHUB ROBOTICS
                       │
              ┌────────┴────────┐
              │                 │
          SIMULATION         HARDWARE
              │                 │
        ┌─────┼─────┐      ┌────┼─────┐
        ↓     ↓     ↓      ↓    ↓     ↓
       C++  Python  TS   ESP32 Arduino Pi
        │     │     │      │    │     │
        └─────┼─────┘      └────┼─────┘
              │                 │
              └────────┬────────┘
                       ↓
                     ROS 2
                       ↓
                      AI
```

The same project could theoretically progress from:

```text
Blockly
   ↓
Python
   ↓
C++
   ↓
ROS 2
   ↓
Real Robot
```

**without leaving the application.**

---

# One thing I would change from your original concept

Don't call it simply a **"web browser."**

Technically, you're building something closer to:

### **Offline Robotics IDE / Robotics Studio**

Think:

**VS Code + Webots + Tinkercad + Scratch + ROS 2**

in one environment.

The interface happens to use **web technologies**.

That's actually a very strong architecture.

---

## And the development stack I'd seriously consider

```text
┌─────────────────────────────────────────┐
│               UI                         │
│ React + TypeScript                       │
│ Blockly                                  │
│ Monaco Editor                            │
│ Three.js / Babylon.js                    │
│ WebGPU                                   │
├─────────────────────────────────────────┤
│           APPLICATION SHELL              │
│ Tauri                                    │
├─────────────────────────────────────────┤
│             NATIVE CORE                  │
│ C++                                      │
│ Physics                                  │
│ Robotics                                 │
│ Hardware                                 │
├─────────────────────────────────────────┤
│              PYTHON                      │
│ Embedded/local Python                    │
│ AI / CV / education                      │
├─────────────────────────────────────────┤
│              ROS 2                       │
│ Optional local installation              │
├─────────────────────────────────────────┤
│          LOCAL STORAGE                   │
│ SQLite + project files                   │
├─────────────────────────────────────────┤
│          OPTIONAL INTERNET               │
│ Asset store / updates / cloud sync       │
└─────────────────────────────────────────┘
```

And I would make **offline operation a fundamental architectural requirement from day one**, not something added later.
