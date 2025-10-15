#!/bin/bash
if ! command -v maim &> /dev/null; then
    echo "Error: 'maim' is not installed. Install it with: sudo apt install maim"
    exit 1
fi

if ! command -v xclip &> /dev/null; then
    echo "Error: 'xclip' is not installed. Install it with: sudo apt install xclip"
    exit 1
fi

maim -s | xclip -selection clipboard -t image/png

if [ $? -eq 0 ]; then
    echo "Screenshot copied to clipboard!"
else
    echo "Screenshot cancelled or failed."
    exit 1
fi
