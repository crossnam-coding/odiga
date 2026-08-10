// GET /api/search — 조건으로 장소를 찾고 근거를 붙여 돌려준다.
//
// 설계 원칙 (2026-08-03 실측에서 도출):
//  1) 협찬 여부를 판별하지 않는다. 협찬 글에 없는 정보(콘센트·에어컨·체류·가격)만 뽑는다.
//  2) 모든 주장에는 원문 링크와 날짜를 붙인다. 없으면 "미확인"으로 남긴다.
//  3) 최다 언급이 곧 상위가 아니다. 조건 근거가 몇 개 잡혔는지로 정렬한다.
//
// 실측 근거: 협찬 표기 검출률은 본문 14.2%(17/120)에 그쳐 판별 자체가 성립하지 않았다.
// 반면 "콘센트"·"에어컨"·가격 같은 체류 정보는 실제 방문자만 쓴다.

const NAVER = 'https://naverapihub.apigw.ntruss.com/search/v1';

// 검색 API 함정 (2026-08-03 실측, 경로 후보 12개 시도 끝에 확정):
//  · 호스트는 naveropenapi 가 아니라 naverapihub
//  · 경로는 /v1/search/blog 가 아니라 /search/v1/blog (순서 반대)
//  · .json 확장자를 붙이면 404
//  · 헤더는 X-Naver-Client-Id 가 아니라 X-NCP-APIGW-API-KEY-ID
function naverHeaders(env) {
  return {
    'X-NCP-APIGW-API-KEY-ID': env.NCP_APIGW_KEY_ID,
    'X-NCP-APIGW-API-KEY': env.NCP_APIGW_KEY,
  };
}

/* ── 조건 사전 ──
   왼쪽은 사용자가 쓰는 말, 오른쪽은 블로그 본문에서 실제로 등장하는 표현. */
const ASPECTS = [
  { key: '작업',   ask: /노트북|작업|공부|콘센트|충전|와이파이/,
    hit: /콘센트|충전기?\s*(꽂|사용)|노트북|와이파이|wifi/i },
  { key: '에어컨', ask: /에어컨|시원|더위|냉방/,
    hit: /에어컨|냉방|시원하|(안|안\s)덥/ },
  { key: '체류',   ask: /오래|시간|눈치|머무/,
    hit: /\d\s*시간\s*(정도|가까이|이상|넘게)?\s*(있|머무|앉)|눈치\s*(안|없)/ },
  { key: '주차',   ask: /주차|차로|운전/,
    hit: /주차(장|공간)?\s*(넉넉|널널|넓|가능|무료|완비)|주차\s*\d+\s*대/ },
  { key: '저자극', ask: /조미료|자극|담백|건강|자연/,
    hit: /자극적이지\s*않|조미료\s*(안|없|적)|담백|슴슴|재료\s*본연/ },
  // 오빠는 "어머니"가 아니라 "엄마"라고 쓴다. 나이를 조건으로 적기도 한다("75세").
  // 사전이 오빠 말투를 못 따라가면 조건이 통째로 안 잡힌다(2026-08-09 실측: asked=[]).
  { key: '어르신', ask: /어머니|아버지|부모님|어른|어르신|가족|엄마|아빠|엄니|모친|부친|할머니|할아버지|\d+\s*[세살]/,
    hit: /부모님|어르신|어머니|아버지|엄마|아빠|모시(고|기)|연세|고령/ },
  { key: '뷰',     ask: /뷰|전망|경치|강|바다|창/,
    hit: /통창|뷰\s*맛집|전망|강이?\s*보이|풍경/ },
];

/* ── 무엇을 찾는지 ──
   조건 문장을 그대로 지역 검색에 넣으면 결과가 0이 된다(2026-08-03 실측).
   "가평 카페 노트북 콘센트"는 30건 중 가평이 2건이었고, 나머지는 전부 다른 지역이었다.
   그래서 문장에서 검색 가능한 종류만 뽑아 쿼리로 쓰고, 나머지 조건은 근거 추출에만 쓴다. */
const KINDS = [
  // '한식'이 빠져 있어서 "엄마랑 저녁 75세 한식 좋아하심" 이 폴백으로 새고, 앞 두 어절인
  // "엄마랑"·"저녁"이 검색어가 됐다. 실제로 "용인 한식"으로 넣으면 제대로 나온다(2026-08-09).
  '한식','양식','아시안','퓨전',
  '한정식','백반','국밥','순대','순댓국','칼국수','막국수','수제비','두부','순두부','산채정식','정식',
  '냉면','삼겹살','고깃집','고기','소고기','돼지고기','갈비','곱창','족발','보쌈','닭갈비','백숙','삼계탕',
  '생선구이','생선조림','생선','갈치','고등어','조기','장어','아귀찜','대구탕','알탕','해물탕',
  '횟집','회','물회','매운탕','추어탕','조림','찜','구이','탕','전골','수육',
  '카페','커피','브런치','베이커리','빵집','디저트','파스타','피자','스테이크','샐러드',
  '중식','짜장면','짬뽕','탕수육','마라탕','초밥','스시','일식','돈까스','우동','라멘','규동',
  '분식','국수','쌈밥','비빔밥','덮밥','도시락','뷔페','샤브샤브','만두','죽','칼국수',
];
// 조건을 말하는 단어들. 검색어로 쓰면 안 된다.
// 사람·시간·서술어가 여기 없으면 그대로 상호명 검색이 되어버린다 —
// "엄마랑 저녁"이 남아 키즈카페 "엄마랑아이랑", 여성의류 "엄마랑딸이랑"을 물어왔다(2026-08-09).
const NOT_KIND = /어머니|아버지|부모님|어른|어르신|가족|엄마|아빠|엄니|모친|부친|할머니|할아버지|친구|혼자|모시고|이?랑|같이|함께|아침|점심|저녁|밤|새벽|주말|평일|오늘|내일|먹고|드시|싶|하는데|하심|좋아|주차|조미료|에어컨|콘센트|노트북|담백|자극|저렴|가성비|조용|근처|여기|괜찮|좋은|맛있|추천|곳|집인?데|요$|해줘|찾아/g;

function searchTerms(q, region) {
  const found = KINDS.filter((k) => q.includes(k));
  found.sort((a, b) => b.length - a.length);   // "생선구이"가 "생선"보다 구체적이다
  let kinds = found.slice(0, 3);

  // 사전에 없는 음식을 말할 수 있다. "맛집"으로 뭉뚱그리면 엉뚱한 게 나온다.
  // (실측: "엄마랑 생선 먹고 싶다" → 사전에 생선이 없어 베이커리가 나왔다.)
  // 조건어를 걷어내고 남은 말을 그대로 검색어로 쓴다.
  if (!kinds.length) {
    const rest = q.replace(NOT_KIND, ' ').replace(/[^가-힣a-zA-Z ]/g, ' ')
      .split(/\s+/).filter((w) => w.length >= 2 && !REGION_HINT.test(w));
    kinds = rest.slice(0, 2);
  }
  if (!kinds.length) kinds.push('맛집');
  return kinds.map((k) => (region ? `${region} ${k}` : k));
}
// 지역명이 검색어에 두 번 들어가지 않게.
const REGION_HINT = /(시|군|구|읍|면|동|리|역)$/;

/* ── 여기가 좋은 집이라는 근거 ──
   지역 검색이 준 순서를 그대로 믿으면 안 된다. 그 순서는 네이버의 노출 순위이지
   "좋은 집"의 근거가 아니다. 광고를 피하려고 만든 도구가 광고 순서를 그대로 쓰면 의미가 없다.

   그래서 협찬 글이 쓰지 못하는 문장만 근거로 센다.
   30분 있다 사진만 찍고 간 사람은 다시 오지 않고, 다른 집과 비교하지 못하고,
   단점을 적으면서까지 추천하지 않는다.

   실측 주의(2026-08-03): "재방문"이라는 단어만 보면 안 된다. 농우본갈비 후기의
   "6명이 60만 원, 재방문은?"은 부정이었다. 긍정형만 인정하고 의문·부정형은 제외한다. */
const GOOD = [
  { k: '재방문',   re: /(또 ?(왔|와서|가|먹|찾)|재방문 ?(의사|할 ?만|하고 ?싶|각|확정)|[두세네] ?번째 ?(방문|왔|와)|단골|자주 ?(와|가|들))/ },
  { k: '비교우위', re: /((가 ?본|먹어 ?본)[^.]{0,20}중(에|에서)? ?(제일|가장)|보다 ?(여기|이 ?집|이 ?곳)가|차라리 ?(여기|이 ?집)|여기가 ?(제일|훨씬|더) ?(낫|좋))/ },
  { k: '현지',     re: /(현지인|동네 ?(사람|주민|맛집)|주민들이|로컬 ?맛집)/ },
  // 단점을 실제로 적은 뒤 그럼에도 추천해야 한다.
  // "웨이팅은 기본!"처럼 사람 많음을 자랑하는 문장은 단점 인정이 아니다.
  { k: '단점인정', re: /(웨이팅이? ?(길|심하|있)|한참 ?기다|자리가? ?좁|시끄러|아쉬웠|좀 ?비싸)[^.]{0,35}(그래도|그런데도|하지만|불구하고|감수|갈 ?만|또 ?가)/ },
];
// 위 표현이 의문·부정으로 쓰인 경우. 이게 걸리면 근거로 세지 않는다.
const NOT_GOOD = /(재방문은\?|재방문 ?(의사)? ?(없|안|글쎄|의문)|다시 ?(는|올 ?일|갈 ?일)? ?(없|안)|기대(했던)?[^.]{0,10}만큼은? ?아니|굳이 ?다시)/;

/* ── 광고처럼 쓴 문장 ──
   협찬 여부 자체는 판별할 수 없다(표기 검출률 14.2%). 하지만 "이 문장이 광고 말투인가"는
   문장 하나만 보면 되는 훨씬 쉬운 문제다.
   근거를 지우지는 않는다. 판단은 사람이 하고, 도구는 "이건 광고처럼 읽힌다"고 표시만 한다. */
const AD_TONE = /(맛집 ?)?(인증|인정)합?니다|믿고 ?(먹|가|드)|여기가 ?(답|진리)|강력 ?추천|무조건 ?(가|드|먹)|인생 ?(맛집|메뉴|샷)|역대급|존맛|JMT|여긴 ?못 ?참|실패 ?없|안 ?가면 ?후회|필수 ?코스|웨이팅은 ?기본|재방문 ?각|찐맛집|맛집 ?인정|후회 ?없/i;
// 대가성을 밝힌 글. 이건 명시적이라 확실하다.
const DISCLOSED = /(소정의|업체(로부터|에서)|제공받아|지원받아|협찬|체험단|원고료|무상 ?제공)/;

// 지뢰: 가서야 아는 것. 이런 문장은 협찬 글이 절대 쓰지 않는다.
const HAZARD = /웨이팅\s*\d+\s*분|줄\s*서|바람\s*(많이\s*)?들어|추웠|더웠|시끄러|불친절|재방문\s*(안|의사\s*없)|또\s*가진\s*않|포장\s*(이\s*)?안\s*[돼되]/;
const PRICE = /([1-9]\d{0,2},\d{3})\s*원/g;

/* ── 먹는 데가 맞는가 ──
   네이버 지역 검색은 업종을 가리지 않고 준다. 검색어가 조금만 어긋나면 엉뚱한 업종이 온다.
   실측(2026-08-09) "용인 엄마랑": 패션>여성의류 · 컴퓨터프로그래밍,정보서비스업>인터넷상거래 ·
   생활,편의>공방 이 결과로 나왔다. category 1단계로 거른다. */
// 앞자리 고정(^)으로 걸렀더니 "브런치,카페" 같은 값이 탈락해 카페가 5곳에서 3곳으로 줄었다.
// 업종 문자열 어디에든 걸리면 통과시킨다 — 비음식 업종에는 이 단어들이 안 들어간다.
const FOOD = /음식점|한식|양식|중식|일식|분식|뷔페|술집|주점|치킨|피자|패스트푸드|아시아음식|카페|커피|찻집|간식|제과|베이커리|디저트|브런치|샐러드|도시락|요리/;
const NOT_FOOD = /키즈카페/;

const strip = (s) => (s || '').replace(/<[^>]*>/g, '').replace(/&[a-z]+;/g, ' ').trim();

async function naver(env, kind, params) {
  const url = `${NAVER}/${kind}?${new URLSearchParams(params)}`;
  const r = await fetch(url, { headers: naverHeaders(env) });
  if (!r.ok) throw new Error(`naver ${kind} ${r.status}`);
  return r.json();
}

/* 가게 사진 (2026-08-10 실측으로 이 경로만 남았다).
   · 블로그 본문 사진(postfiles.pstatic.net)은 못 쓴다. referer 없이는 200 이지만
     우리 도메인을 referer 로 붙이면 403 이다 = 네이버가 핫링크를 막아뒀다.
   · 이미지 검색 API 가 주는 지역DB 사진(ldb-phinf.pstatic.net)은 referer 를 붙여도 200 이다.
     API 가 정식으로 주는 주소라 우회가 아니다. 키는 블로그·지역 검색과 같은 것을 쓴다.
   정확도: "우대포 분당직영점" 으로 찾으면 "우대포 위례본점" 이 1위로 섞여 온다.
   제목에 가게명이 그대로 든 것만 채택하고, 없으면 사진을 안 붙인다 — 틀린 가게 사진보다 없는 게 낫다.
   무게: 원본(link)은 989KB 짜리도 온다 — 5곳×여러 장이면 폰에서 못 쓴다. ldb 원본은 리사이즈
   파라미터를 안 받는다(?type=w560 → 404). 대신 API 가 같이 주는 thumbnail(search.pstatic.net)은
   type 으로 크기가 바뀐다: b150=13KB · b300=47KB · b400=78KB(실측). 카드 폭이 화면의 62% 라
   b400 을 쓴다 — 원본의 1/12 이고 레티나에서도 안 뭉갠다. */
async function photosFor(env, name) {
  try {
    const d = await naver(env, 'image', { query: name, display: 10 });
    const out = [];
    for (const i of d.items || []) {
      if (!i.link || !i.link.includes('ldb-phinf.pstatic.net')) continue;
      if (!strip(i.title).includes(name)) continue;
      const t = (i.thumbnail || '').replace(/([?&])type=b\d+/, '$1type=b400');
      if (!t || out.includes(t)) continue;             // 같은 사진이 두 번 오기도 한다
      out.push(t);
      if (out.length === 3) break;
    }
    return out;
  } catch (e) {                                        // 사진은 덤이다. 실패해도 검색은 살린다
    stamp({ ev: 'photo_fail', name, err: String(e.message || e) });
    return [];
  }
}

// 블로그 본문. blog.naver.com/<id>/<logNo> 는 200이어도 프레임셋 껍데기(20자)라
// PostView.naver 를 써야 전문이 온다. 데스크탑 UA가 아니면 JS 리다이렉트 스텁만 온다.
async function postBody(link) {
  const m = link.match(/blog\.naver\.com\/([^/?#]+)\/(\d+)/);
  if (!m) return '';
  const url = `https://blog.naver.com/PostView.naver?blogId=${m[1]}&logNo=${m[2]}`
            + `&redirect=Dlog&widgetTypeCall=true&directAccess=false`;
  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) '
        + 'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36' },
    });
    // 본문을 못 읽으면 근거가 통째로 안 나온다. 조용히 넘기면 "왜 근거가 없지"를 알 수 없다.
    if (!r.ok) { stamp({ ev: 'blog_http', status: r.status, blog: `${m[1]}/${m[2]}` }); return ''; }
    let t = (await r.text())
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&[a-z#0-9]+;/gi, ' ');

    // 블로그 UI·추천글이 본문에 섞여 들어온다. 그대로 두면 인용문이 쓰레기가 된다.
    t = t.replace(/URL 복사|이웃추가|공유하기|신고하기|기타 기능|본문 기타|댓글쓰기|블로그 홈|서로이웃|이 블로그.*?카테고리 글/g, ' ')
         .replace(/\d{1,2}:\d{2}/g, ' ')
         .replace(/\s+/g, ' ');
    // 하단 추천글 영역 이후는 다른 가게 이야기다. 잘라낸다.
    const cut = t.search(/관련 ?글|함께 ?볼만한|이 ?블로그의 ?인기|추천 ?포스트|다른 ?사람들이/);
    if (cut > 400) t = t.slice(0, cut);
    return t;
  } catch (e) {
    stamp({ ev: 'blog_fail', blog: `${m[1]}/${m[2]}`, err: String(e.message || e) });
    return '';
  }
}

// 한국어 블로그는 마침표를 잘 안 쓴다. 종결어미·줄바꿈까지 문장 경계로 본다.
const BOUND = /[.!?]|다\s|요\s|음\s|임\s|![\s]|~\s/g;
function sentenceAround(text, re) {
  const m = text.match(re);
  if (!m) return null;
  const i = m.index;
  let s = 0, e = text.length;
  BOUND.lastIndex = 0;
  for (let b; (b = BOUND.exec(text)); ) {
    if (b.index < i) s = b.index + b[0].length;
    else { e = b.index + b[0].length; break; }
  }
  const out = text.slice(Math.max(s, i - 110), Math.min(e, i + 110)).trim();
  // UI 잔재가 남았거나 너무 짧으면 근거로 쓰지 않는다.
  if (out.length < 12 || /URL|이웃|신고|공유/.test(out)) return null;
  return out.slice(0, 130);
}

// 좌표를 지역명으로. 네이버 지역 검색은 좌표로 범위를 좁힐 수 없어서 지역명이 반드시 필요한데,
// 위치를 잡아놓고 사용자에게 지역명을 또 물어보는 건 말이 안 된다.
async function regionFromCoords(lat, lng) {
  try {
    const r = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&zoom=10&accept-language=ko`
      + `&lat=${lat}&lon=${lng}`,
      { headers: { 'User-Agent': 'odiga/1.0 (https://odiga-eyf.pages.dev)' } });
    if (!r.ok) return '';
    const a = (await r.json()).address || {};
    const name = a.city || a.county || a.town || a.borough || a.city_district || a.province || '';
    // "가평군" 보다 "가평" 이 블로그에서 더 많이 쓰인다.
    return name.replace(/(특별시|광역시|자치시|자치도)$/, '').replace(/(시|군|구)$/, '') || name;
  } catch { return ''; }
}

/* 로그 (2026-08-10 오빠 지적으로 신설).
   그때까지 이 파일의 console 출력은 0개였다. 조용히 삼키는 catch 가 다섯 군데라
   "왜 근거가 안 나왔는지" 물어볼 데가 없었다.
   보는 법:  npx wrangler@4 pages deployment list --project-name odiga   ← 배포 ID 확인
             npx wrangler@4 pages deployment tail <배포ID> --project-name odiga
   한 줄에 JSON 으로 담는다. 여러 줄로 흩으면 동시 요청이 섞여 못 읽는다.
   실시간이라 지나간 실패는 못 본다 — 그래서 화면에도 같은 코드를 띄운다(rid + 단계). */
const stamp = (o) => { try { console.log(JSON.stringify(o)); } catch { /* 로그가 요청을 죽이면 안 된다 */ } };

export async function onRequestGet({ request, env }) {
  const t0 = Date.now();
  // 화면에 뜬 실패와 서버 로그를 맞춰보기 위한 짧은 표식. 오빠가 이것만 알려줘도 찾을 수 있다.
  const rid = Math.random().toString(36).slice(2, 6);
  const u = new URL(request.url);
  const q     = (u.searchParams.get('q') || '').trim();
  const lat   = parseFloat(u.searchParams.get('lat'));
  const lng   = parseFloat(u.searchParams.get('lng'));
  let region  = (u.searchParams.get('region') || '').trim();
  // 글로브박스에 넣어둔 조건. 매번 손으로 다시 쓰지 않게 브라우저가 붙여 보낸다.
  // 서버는 프로필을 저장하지 않는다 — 오빠 취향은 오빠 기기 밖으로 나가지 않는다.
  const withKeys = (u.searchParams.get('with') || '').split(',').map((s) => s.trim()).filter(Boolean);

  const json = (body, status = 200) => new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8',
               'cache-control': 'public, max-age=60' },
  });

  if (!q) return json({ error: '조건을 입력해줘' }, 400);
  if (!env.NCP_APIGW_KEY_ID || !env.NCP_APIGW_KEY) {
    // 이게 뜨면 앱 전체가 죽은 것이다. 조용히 넘기면 안 된다.
    console.error(JSON.stringify({ ev: 'no_key', rid }));
    return json({ error: `서버에 네이버 검색 키가 설정되지 않았어 · rid ${rid}`, rid }, 500);
  }

  // 사용자가 실제로 물어본 조건 + 글로브박스에 켜둔 조건.
  // 추측으로 채우는 게 아니라 둘 다 사용자가 말한 것이다 — 하나는 지금, 하나는 미리.
  // 어느 쪽에서 왔는지는 응답에 나눠 담아 화면이 구분해 보여줄 수 있게 한다.
  const asked = ASPECTS.filter((a) => a.ask.test(q) || withKeys.includes(a.key));
  const fromProfile = asked.filter((a) => !a.ask.test(q)).map((a) => a.key);

  // 지역명을 안 썼으면 위치에서 뽑는다.
  let regionFrom = region ? '입력' : null;
  if (!region && Number.isFinite(lat) && Number.isFinite(lng)) {
    region = await regionFromCoords(lat, lng);
    if (region) regionFrom = '현재 위치';
  }
  if (!region) {
    return json({ error: '어디 근처인지 모르겠어 — 위치를 허용하거나 조건에 지역을 같이 써줘' }, 400);
  }

  try {
    // 1) 후보 장소 — 지역 검색은 좌표를 준다.
    //    display 최대 5, start는 1뿐이라 페이징이 안 된다(2026-08-03 실측).
    //    그래서 종류별로 쿼리를 나눠 던지고 합친다.
    const terms = searchTerms(q, region);
    const locals = await Promise.all(
      terms.map((t) => naver(env, 'local', { query: t, display: 5 })
        .catch((e) => { stamp({ ev: 'local_fail', rid, term: t, err: String(e.message || e) }); return { items: [] }; }))
    );
    const seen = new Set();
    const cands = locals.flatMap((l) => l.items || [])
      .filter((i) => FOOD.test(i.category || '') && !NOT_FOOD.test(i.category || ''))
      .map((i) => ({
        name: strip(i.title),
        kind: (i.category || '').split('>').pop()?.trim() || '',
        addr: i.roadAddress || i.address || '',
        // 네이버 지역 좌표는 WGS84 * 1e7 정수
        lat: i.mapy ? Number(i.mapy) / 1e7 : null,
        lng: i.mapx ? Number(i.mapx) / 1e7 : null,
      }))
      .filter((c) => {
        if (!c.lat || !c.lng || seen.has(c.name)) return false;
        seen.add(c.name);
        return true;
      })
      .slice(0, 6);

    if (!cands.length) return json({ query: q, asked: asked.map(a => a.key), fromProfile, places: [] });

    // 2) 각 후보의 근거를 블로그 본문에서 뽑는다.
    const places = await Promise.all(cands.map(async (c) => {
      const blog = await naver(env, 'blog', { query: `${c.name} ${region}`.trim(), display: 6, sort: 'sim' })
        .catch(() => ({ items: [] }));

      const posts = (blog.items || []).slice(0, 5);
      const fetched = await Promise.all(posts.map(async (p) => ({
        url: p.link,
        date: p.postdate ? `${p.postdate.slice(0,4)}-${p.postdate.slice(4,6)}-${p.postdate.slice(6,8)}` : null,
        text: await postBody(p.link),
      })));

      // 같은 이름의 다른 가게가 섞인다. 실측: "송원"(상면 수목원로 한정식) 검색에
      // "송원막국수"(가평읍 가화로) 글이 근거로 붙었다.
      // 본문에 이 가게의 도로명 조각이 있는 글만 근거로 인정한다.
      const road = (c.addr.match(/[가-힣]+(로|길)\s*\d+/) || [])[0];
      const dong = (c.addr.match(/[가-힣]+(면|읍|동)/) || [])[0];
      const bodies = fetched.filter((b) => {
        if (!b.text) return false;
        if (road && b.text.includes(road)) return true;
        if (dong && b.text.includes(dong) && b.text.includes(c.name)) return true;
        return false;
      });

      const evidence = [];
      for (const a of asked) {
        for (const b of bodies) {
          if (!b.text) continue;
          const quote = sentenceAround(b.text, a.hit);
          if (quote) { evidence.push({ k: a.key, q: quote, url: b.url, date: b.date,
            ad: DISCLOSED.test(b.text) ? '대가성 밝힘' : (AD_TONE.test(quote) ? '광고 말투' : null) }); break; }
        }
      }

      // 여기가 좋은 집이라는 근거. 없으면 없다고 말한다.
      const good = [];
      for (const g of GOOD) {
        for (const b of bodies) {
          if (!b.text) continue;
          const quote = sentenceAround(b.text, g.re);
          if (!quote || NOT_GOOD.test(quote)) continue;   // 의문·부정형은 근거가 아니다
          good.push({
            k: g.k, q: quote, url: b.url, date: b.date,
            // 근거는 남기되 어떻게 읽어야 하는지 같이 준다.
            ad: DISCLOSED.test(b.text) ? '대가성 밝힘' : (AD_TONE.test(quote) ? '광고 말투' : null),
          });
          break;
        }
      }

      const warn = [];
      for (const b of bodies) {
        const h = b.text && sentenceAround(b.text, HAZARD);
        if (h) { warn.push({ q: h, url: b.url, date: b.date }); break; }
      }
      // 재방문을 되묻거나 기대에 못 미쳤다는 문장은 경고로 올린다.
      for (const b of bodies) {
        const d = b.text && sentenceAround(b.text, NOT_GOOD);
        if (d) { warn.push({ q: d, url: b.url, date: b.date }); break; }
      }

      // 본문 아무 숫자나 긁으면 "4,000~175,000원" 같은 쓰레기가 나온다.
      // 앞뒤 30자 안에 메뉴 문맥이 있는 금액만 센다.
      const MENU = /메뉴|정식|한상|세트|１?인분|1인|가격|주문|시켰|먹었|커피|아메리카노|막국수|전골|보쌈|비빔|국수|탕|찌개/;
      const prices = [];
      for (const b of bodies) {
        const t = b.text || '';
        for (const m of t.matchAll(PRICE)) {
          const v = Number(m[1].replace(',', ''));
          if (v < 4000 || v > 100000) continue;
          if (MENU.test(t.slice(Math.max(0, m.index - 30), m.index + 30))) prices.push(v);
        }
      }
      prices.sort((x, y) => x - y);

      // 못 채운 조건은 감추지 않고 "미확인"으로 남긴다.
      const missing = asked.map(a => a.key).filter(k => !evidence.some(e => e.k === k));

      return {
        ...c,
        evidence,
        good,
        missing,
        warn,
        priceLow: prices[0] ?? null,
        priceHigh: prices[prices.length - 1] ?? null,
        score: evidence.length,
        // 좋은 집이라는 근거에 더 무게를 둔다. 조건은 맞아도 맛이 없을 수 있다.
        rank: evidence.length + good.length * 2 - warn.length,
      };
    }));

    // 네이버가 준 순서가 아니라, 근거가 몇 개 잡혔는지로 다시 세운다.
    places.sort((a, b) => b.rank - a.rank);

    // 사진은 순서가 정해진 뒤에 붙인다. 다섯 곳을 한꺼번에 물어보고, 늦어도 검색을 막지 않는다.
    await Promise.all(places.map(async (p) => { p.photos = await photosFor(env, p.name); }));

    // 성공도 남긴다. 실패만 남기면 "근거가 왜 적지" 같은 물음에 답할 수 없다.
    stamp({
      ev: 'ok', rid, ms: Date.now() - t0, region, regionFrom,
      q: q.slice(0, 60), asked: asked.map((a) => a.key),
      곳: places.length,
      근거없는곳: places.filter((p) => !p.evidence.length).length,
      사진없는곳: places.filter((p) => !p.photos.length).length,
    });
    return json({
      query: q,
      asked: asked.map(a => a.key),
      fromProfile,
      region,
      regionFrom,
      origin: Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null,
      places,
      rid,
      collectedAt: new Date().toISOString(),
    });
  } catch (e) {
    // 화면에도 같은 rid 를 띄운다. 오빠가 "실패했어, rid a3f2" 한 마디면 로그에서 찾을 수 있다.
    console.error(JSON.stringify({ ev: 'fail', rid, ms: Date.now() - t0,
      q: q.slice(0, 60), region, err: String(e.message || e), stack: String(e.stack || '').slice(0, 300) }));
    return json({ error: `${String(e.message || e)} · rid ${rid}`, rid }, 502);
  }
}
