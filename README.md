3D Object Rendering with Octree Optimization
Overview
This project demonstrates real-time 3D object rendering in the browser using JavaScript, with a comparison between:

Rendering with Octree spatial partitioning
Rendering without Octree

The goal is to analyze performance differences using FPS (Frames Per Second).

Features
Real-time 3D rendering using Canvas/WebGL
Octree-based spatial partitioning
Toggle between:
With Octree
Without Octree
FPS counter for performance comparison
Free movement in 3D space (game-like camera)

Concept Used
Spatial Data Structures (Octree)
Collision / Visibility Optimization
Rendering Pipeline Basics

Why Octree?
Octree reduces unnecessary computations by dividing 3D space into smaller regions.

Without Octree:
Every object is checked → O(n)

With Octree:
Only nearby objects checked → O(log n)
