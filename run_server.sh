#!/bin/bash

# Check if conda is installed
if ! command -v conda &> /dev/null; then
    echo "Error: conda is not installed. Please install Miniconda or Anaconda first."
    exit 1
fi

# Check if ffmpeg is installed
if ! command -v ffmpeg &> /dev/null; then
    echo "Error: ffmpeg is not installed. Please install it (e.g., 'brew install ffmpeg' on macOS)."
    exit 1
fi

# Activate the sharp environment
echo "Activating 'sharp' environment..."
source $(conda info --base)/etc/profile.d/conda.sh
conda activate sharp

if [ $? -ne 0 ]; then
    echo "Error: Failed to activate 'sharp' environment. Did you create it?"
    echo "Run: conda create -n sharp python=3.13 && conda activate sharp && pip install -r requirements.txt"
    exit 1
fi

# Run the server
echo "Starting server..."
uvicorn server.main:app --reload --host 127.0.0.1 --port 8000

