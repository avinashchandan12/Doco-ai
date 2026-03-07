#!/bin/bash
PID=$(lsof -t -i:8000)
if [ ! -z "$PID" ]; then
  kill -9 $PID
fi
