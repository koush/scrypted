#!/bin/bash

# Script to create a 2-second MP4 video from camera-slash.jpg
# Using H.264 Main profile, no audio, 10fps, 1 keyframe

cd $(dirname $0)
ffmpeg -y -loop 1 -i ../snapshot/fs/camera-slash.jpg -c:v libx264 -profile:v main -t 4 -r 10 -pix_fmt yuv420p -g 10 fs/camera-slash.mp4
