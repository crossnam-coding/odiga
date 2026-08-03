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
  { key: '어르신', ask: /어머니|아버지|부모님|어른|어르신|가족/,
    hit: /부모님|어르신|어머니|모시(고|기)/ },
  { key: '뷰',     ask: /뷰|전망|경치|강|바다|창/,
    hit: /통창|뷰\s*맛집|전망|강이?\s*보이|풍경/ },
];

/* ── 무엇을 찾는지 ──
   조건 문장을 그대로 지역 검색에 넣으면 결과가 0이 된다(2026-08-03 실측).
   "가평 카페 노트북 콘센트"는 30건 중 가평이 2건이었고, 나머지는 전부 다른 지역이었다.
   그래서 문장에서 검색 가능한 종류만 뽑아 쿼리로 쓰고, 나머지 조건은 근거 추출에만 쓴다. */
const KINDS = [
  '한정식','백반','국밥','칼국수','막국수','수제비','두부','순두부','산채정식','정식',
  '냉면','삼겹살','고깃집','고기','횟집','물회','매운탕','백숙','닭갈비','추어탕','보쌈',
  '카페','커피','브런치','베이커리','빵집','디저트','파스타','피자','스테이크',
  '중식','짜장면','짬뽕','초밥','일식','돈까스','우동','라멘','분식','국수','쌈밥','비빔밥',
];
function searchTerms(q, region) {
  const found = KINDS.filter((k) => q.includes(k));
  // 긴 것부터 — "산채정식"이 "정식"보다 구체적이다.
  found.sort((a, b) => b.length - a.length);
  const kinds = found.slice(0, 3);
  if (!kinds.length) kinds.push('맛집');
  return kinds.map((k) => (region ? `${region} ${k}` : k));
}

// 지뢰: 가서야 아는 것. 이런 문장은 협찬 글이 절대 쓰지 않는다.
const HAZARD = /웨이팅\s*\d+\s*분|줄\s*서|바람\s*(많이\s*)?들어|추웠|더웠|시끄러|불친절|재방문\s*(안|의사\s*없)|또\s*가진\s*않|포장\s*(이\s*)?안\s*[돼되]/;
const PRICE = /([1-9]\d{0,2},\d{3})\s*원/g;

const strip = (s) => (s || '').replace(/<[^>]*>/g, '').replace(/&[a-z]+;/g, ' ').trim();

async function naver(env, kind, params) {
  const url = `${NAVER}/${kind}?${new URLSearchParams(params)}`;
  const r = await fetch(url, { headers: naverHeaders(env) });
  if (!r.ok) throw new Error(`naver ${kind} ${r.status}`);
  return r.json();
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
    if (!r.ok) return '';
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
  } catch { return ''; }
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

export async function onRequestGet({ request, env }) {
  const u = new URL(request.url);
  const q     = (u.searchParams.get('q') || '').trim();
  const lat   = parseFloat(u.searchParams.get('lat'));
  const lng   = parseFloat(u.searchParams.get('lng'));
  const region= (u.searchParams.get('region') || '').trim();

  const json = (body, status = 200) => new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8',
               'cache-control': 'public, max-age=300' },
  });

  if (!q) return json({ error: '조건을 입력해줘' }, 400);
  if (!env.NCP_APIGW_KEY_ID || !env.NCP_APIGW_KEY) {
    return json({ error: '서버에 네이버 검색 키가 설정되지 않았어' }, 500);
  }

  // 사용자가 실제로 물어본 조건만 남긴다. 안 물어본 건 채우지 않는다.
  const asked = ASPECTS.filter((a) => a.ask.test(q));

  try {
    // 1) 후보 장소 — 지역 검색은 좌표를 준다.
    //    display 최대 5, start는 1뿐이라 페이징이 안 된다(2026-08-03 실측).
    //    그래서 종류별로 쿼리를 나눠 던지고 합친다.
    const terms = searchTerms(q, region);
    const locals = await Promise.all(
      terms.map((t) => naver(env, 'local', { query: t, display: 5 }).catch(() => ({ items: [] })))
    );
    const seen = new Set();
    const cands = locals.flatMap((l) => l.items || []).map((i) => ({
      name: strip(i.title),
      kind: (i.category || '').split('>').pop()?.trim() || '',
      addr: i.roadAddress || i.address || '',
      // 네이버 지역 좌표는 WGS84 * 1e7 정수
      lat: i.mapy ? Number(i.mapy) / 1e7 : null,
      lng: i.mapx ? Number(i.mapx) / 1e7 : null,
    })).filter((c) => {
      if (!c.lat || !c.lng || seen.has(c.name)) return false;
      seen.add(c.name);
      return true;
    }).slice(0, 6);

    if (!cands.length) return json({ query: q, asked: asked.map(a => a.key), places: [] });

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
          if (quote) { evidence.push({ k: a.key, q: quote, url: b.url, date: b.date }); break; }
        }
      }

      const warn = [];
      for (const b of bodies) {
        const h = b.text && sentenceAround(b.text, HAZARD);
        if (h) { warn.push({ q: h, url: b.url, date: b.date }); break; }
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
        missing,
        warn,
        priceLow: prices[0] ?? null,
        priceHigh: prices[prices.length - 1] ?? null,
        score: evidence.length,
      };
    }));

    // 조건을 몇 개 실제로 입증했는지로 정렬한다. 언급 횟수가 아니다.
    places.sort((a, b) => b.score - a.score);

    return json({
      query: q,
      asked: asked.map(a => a.key),
      origin: Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null,
      places,
      collectedAt: new Date().toISOString(),
    });
  } catch (e) {
    return json({ error: String(e.message || e) }, 502);
  }
}
