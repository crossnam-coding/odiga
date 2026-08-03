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

rm -rf dist && mkdir -p dist/assets dist/data dist/img dist/functions/api
sed -e "s|assets/app.css|assets/app.css?v=$V|" \
    -e "s|assets/app.js|assets/app.js?v=$V|" index.html > dist/index.html
cp assets/app.css assets/app.js  dist/assets/
cp data/places.json              dist/data/
cp img/songwon1.jpg img/songwon3.jpg img/narin2.jpg dist/img/
cp functions/api/search.js       dist/functions/api/

cat > dist/_headers <<'EOF'
/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
/index.html
  Cache-Control: no-cache
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

echo "배포 $V — $(find dist -type f | wc -l | tr -d ' ')개 파일"
set -a; . ./.env; set +a
export CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID
npx --yes wrangler@4 pages deploy dist --project-name odiga --commit-dirty=true 2>&1 | tail -3
