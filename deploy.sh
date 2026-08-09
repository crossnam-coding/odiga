#!/usr/bin/env bash
# 배포. dist/ 를 새로 구성해서 올린다.
#
# dist 를 따로 두는 이유: wrangler 는 .gitignore 를 보지 않는다.
# 프로젝트 루트를 그대로 올리면 .env 와 개인 메모까지 공개 URL 에 실린다(2026-08-03 실제로 42개가 올라감).
#
# 자산에 ?v= 스탬프를 붙이는 이유: 붙이지 않으면 브라우저가 이전 app.js 를 계속 쓴다.
# 배포는 됐는데 화면은 그대로인 상태가 되어, 고친 게 안 고쳐진 것처럼 보인다.
set -euo pipefail
cd "$(dirname "$0")"

V=$(date +%Y%m%d%H%M)

rm -rf dist && mkdir -p dist/assets dist/icons dist/functions/api
sed -e "s|assets/app.css|assets/app.css?v=$V|" \
    -e "s|assets/app.js|assets/app.js?v=$V|" index.html > dist/index.html
cp assets/app.css assets/app.js assets/regions.js dist/assets/
cp icons/*.png                   dist/icons/
cp manifest.webmanifest          dist/
cp functions/api/*.js            dist/functions/api/

# 아이콘이 /assets/ 가 아니라 /icons/ 에 있는 이유: /assets/* 는 1년 immutable 인데
# 아이콘 경로엔 ?v= 스탬프를 못 붙인다(manifest 와 apple-touch-icon 이 고정 경로를 요구).
# 같은 규칙 아래 두면 아이콘을 바꿔도 1년 동안 옛 아이콘이 남는다.
cat > dist/_headers <<'EOF'
/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
/
  Cache-Control: no-cache, must-revalidate
/index.html
  Cache-Control: no-cache, must-revalidate
/manifest.webmanifest
  Cache-Control: public, max-age=3600
/icons/*
  Cache-Control: public, max-age=86400
/assets/*
  Cache-Control: public, max-age=31536000, immutable
EOF

# 비밀이 섞이면 배포하지 않는다.
if find dist -name ".env*" -o -name "*.b64" -o -name "wrangler.toml" -o -name "프로필*" | grep -q .; then
  echo "중단: dist 에 비공개 파일이 섞였다"; find dist -name ".env*" -o -name "*.b64" -o -name "프로필*"; exit 1
fi
if grep -rlE "NCP_APIGW_KEY=|cfut_|CLOUDFLARE_API_TOKEN" dist 2>/dev/null | grep -q .; then
  echo "중단: dist 안에서 키 문자열이 발견됨"; exit 1
fi

echo "빌드 $V — $(find dist -type f | wc -l | tr -d ' ')개 파일"

# --dry: dist 를 만들고 검사만 한다. 올리지 않는다.
# 배포는 오빠가 "배포해" 라고 한 뒤에만 하는데, 그 전에 번들이 맞는지는 확인해야 한다.
if [ "${1:-}" = "--dry" ]; then
  find dist -type f | sed 's|^dist|  |' | sort
  echo "드라이런 — 올리지 않았다"; exit 0
fi

set -a; . ./.env; set +a
export CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID
npx --yes wrangler@4 pages deploy dist --project-name odiga --commit-dirty=true 2>&1 | tail -3
