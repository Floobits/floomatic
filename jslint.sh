#!/bin/sh

jslint \
--plusplus \
--sloppy \
--todo \
--node \
--nomen \
--indent 2 \
*.js lib/*.js
