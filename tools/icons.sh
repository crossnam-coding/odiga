#!/usr/bin/env bash
# 홈화면 아이콘 PNG 생성. icons/*.svg 를 고친 뒤 이걸 돌린다.
#
# PNG 를 저장소에 커밋해두는 이유: 배포는 wrangler 가 dist 를 그대로 올리는 방식이라
# 배포 시점에 변환 도구(rsvg-convert)가 있어야 하는 구조를 만들면 안 된다.
#
# assets/ 가 아니라 icons/ 에 두는 이유: _headers 에서 /assets/* 는 1년 immutable 인데
# 아이콘은 ?v= 스탬프가 안 붙는다. 같은 경로에 두면 아이콘을 바꿔도 1년간 안 바뀐다.
set -euo pipefail
cd "$(dirname "$0")/.."
command -v rsvg-convert >/dev/null || { echo "rsvg-convert 없음: brew install librsvg"; exit 1; }

for s in 180 192 512; do
  rsvg-convert -w $s -h $s icons/icon.svg -o icons/icon-$s.png
done
rsvg-convert -w 512 -h 512 icons/icon-maskable.svg -o icons/icon-maskable-512.png

ls -l icons/*.png | awk '{print $9, $5"B"}'
