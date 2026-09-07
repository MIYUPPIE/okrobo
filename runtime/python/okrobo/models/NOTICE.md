# Third-party model: YOLOX-Nano

`yolox_nano.onnx` is the official pretrained COCO-80 checkpoint from
[Megvii-BaseDetection/YOLOX](https://github.com/Megvii-BaseDetection/YOLOX),
release `0.1.1rc0`, downloaded unmodified from
`https://github.com/Megvii-BaseDetection/YOLOX/releases/download/0.1.1rc0/yolox_nano.onnx`
(sha256 `c789161ed43c8269fcd4e67c67eeeb4e80c622da2eb296a20bc6007bd18a0b7d`).

Licensed under the Apache License, Version 2.0 — see `LICENSE` in this
directory. Copyright (c) 2021-2022 Megvii Inc.

`okrobo/vision.py`'s own `detect_objects()` post-processing (grid/stride
decode and non-max suppression) is a Python port of YOLOX's own reference
implementation (`demo/ONNXRuntime/onnx_inference.py`, `data_augment.py`,
`demo_utils.py`), adapted to this project's own conventions — a modified
file per the License's own Section 4(b). See
docs/decisions/vision-lab-object-detection.md for why YOLOX-Nano was chosen
over Ultralytics YOLO (Apache-2.0 vs. AGPL-3.0).
