#!/usr/bin/env bash
# aside CLI 대역. argv를 stderr로 보여 주고, 정해진 결과 줄을 stdout에 쓴다.
echo "ARGV:$*" >&2
echo "[system] noise line"
if [ -n "$FAKE_FAIL" ]; then echo "boom" >&2; exit 2; fi
echo '@@RESULT@@{"ok":1,"n":3}'
echo "[ok | 5ms]"
