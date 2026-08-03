// 어디가지 — 조건으로 찾는 장소
// v0: 위치·이동수단·반경은 실제 동작. 실시간 검색은 백엔드(네이버 검색 키) 연결 후.

const MODES = {
  walk: { label: '걸어서', kmh: 4.5, fixed: 0, max: 30, step: 5, def: 15 },
  car:  { label: '차로',   kmh: 38,  fixed: 2, max: 60, step: 5, def: 20 },
};
const ROAD_FACTOR = 1.35; // 직선거리 → 실제 도로 보정

const state = {
  mode: 'car',
  minutes: MODES.car.def,
  origin: null,      // {lat,lng,label}
  places: [],
};

const $ = (s) => document.querySelector(s);

/* ── 거리 ── */
function haversine(a, b) {
  const R = 6371, rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
function travel(km, mode) {
  const m = MODES[mode];
  const road = km * ROAD_FACTOR;
  return { road, min: Math.round((road / m.kmh) * 60 + m.fixed) };
}

/* ── 위치 ── */
function setOrigin(lat, lng, label) {
  state.origin = { lat, lng, label };
  $('#locText').innerHTML = `기준 <b>${label}</b>`;
  render();
}
function locate() {
  const el = $('#locText');
  if (!navigator.geolocation) {
    el.textContent = '이 브라우저는 위치를 지원하지 않아';
    return;
  }
  el.textContent = '위치 잡는 중…';
  navigator.geolocation.getCurrentPosition(
    (p) => setOrigin(p.coords.latitude, p.coords.longitude, '현재 위치'),
    (err) => {
      const why = { 1: '위치 권한이 꺼져 있어', 2: '위치를 못 잡았어', 3: '시간이 초과됐어' }[err.code]
        || '위치를 못 잡았어';
      el.innerHTML = `${why} — 아래에서 직접 골라줘`;
      $('#pickFallback').hidden = false;
    },
    { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 }
  );
}

/* ── 렌더 ── */
function card(p, dist, best) {
  const el = document.createElement('article');
  el.className = 'card' + (best ? ' best' : '');
  const price = p.priceLow
    ? (p.priceLow === p.priceHigh
        ? p.priceLow.toLocaleString() + '원'
        : `${p.priceLow.toLocaleString()}~${p.priceHigh.toLocaleString()}`)
    : '<span style="color:var(--muted);font-weight:600;font-size:13px">' + (p.priceNote || '미확인') + '</span>';

  const far = dist.min > state.minutes;
  const parts = [`
    <div class="cbody">
      <div class="crow">
        <h3 class="cname">${p.name}<small>${p.kind}</small></h3>
        <div class="cprice">${price}</div>
        <div class="cmeta">${p.addr}${p.parking ? ' · ' + p.parking : ''}</div>
        <div class="ctime${far ? ' far' : ''}">${dist.min
          ? `${MODES[state.mode].label} ${dist.min}분 · ${dist.road.toFixed(1)}km`
          : '거리 미계산'}</div>
      </div>`];

  if (p.hours || p.closed) {
    parts.push(`<div class="cmeta">🕘 ${[p.hours, p.closed].filter(Boolean).join(' · ')}</div>`);
  }
  if (p.evidence?.length) {
    parts.push('<div class="ev">' + p.evidence.map((e) => `
      <div class="e"><span class="ek">${e.k}</span><q>${e.q}</q>
      <a href="${e.url}" target="_blank" rel="noopener">${e.date}</a></div>`).join('') + '</div>');
  }
  if (p.warn?.length) {
    parts.push(`<div class="warn"><b>⚠︎ 주의</b>${p.warn.map((w) => `<span>${w}</span>`).join('')}</div>`);
  }
  const mapUrl = `https://map.kakao.com/link/to/${encodeURIComponent(p.name)},${p.lat},${p.lng}`;
  parts.push(`<div class="acts">
      <a class="p" href="${p.tel ? 'tel:' + p.tel.replace(/-/g, '') : '#'}" ${p.tel ? '' : 'aria-disabled="true"'}>${p.tel ? '전화' : '번호 없음'}</a>
      <a href="${mapUrl}" target="_blank" rel="noopener">길찾기</a>
    </div></div>`);

  if (p.photos?.length) {
    parts.push('<div class="shots">' +
      p.photos.map((s) => `<img src="${s}" alt="${p.name} 사진" loading="lazy">`).join('') + '</div>');
  }
  el.innerHTML = parts.join('');
  return el;
}

function render() {
  const box = $('#results');
  box.innerHTML = '';
  if (!state.places.length) {
    box.innerHTML = '<p class="empty">조건을 넣고 찾아줘를 눌러봐</p>';
    return;
  }
  // 위치를 못 잡았어도 결과는 보여준다. 거리만 빠진다.
  if (!state.origin) {
    const head = document.createElement('div');
    head.className = 'rhead';
    head.innerHTML = `<span>${state.places.length}곳 · 거리 미계산</span><span>위치 허용하면 순서가 바뀜</span>`;
    box.appendChild(head);
    state.places.forEach((p, i) => box.appendChild(card(p, { road: 0, min: 0 }, i === 0)));
    return;
  }
  const scored = state.places
    .map((p) => ({ p, d: travel(haversine(state.origin, p), state.mode) }))
    .filter(({ p }) => p.id !== 'riverain' || haversine(state.origin, p) > 0.15)
    .sort((a, b) => a.d.min - b.d.min);

  const inRange = scored.filter((s) => s.d.min <= state.minutes);
  const out = inRange.length ? inRange : scored.slice(0, 3);

  const head = document.createElement('div');
  head.className = 'rhead';
  head.innerHTML = inRange.length
    ? `<span>${MODES[state.mode].label} ${state.minutes}분 안 · ${inRange.length}곳</span><span>수집 8/3</span>`
    : `<span style="color:var(--caution)">${state.minutes}분 안엔 없어 — 가까운 순 3곳</span><span>수집 8/3</span>`;
  box.appendChild(head);
  out.forEach((s, i) => box.appendChild(card(s.p, s.d, i === 0 && inRange.length > 0)));
}

/* ── 조건 검색 ── */
// 네이버 지역 검색은 좌표만으로 범위를 좁힐 수 없다. 지역명이 있어야 결과가 그 동네로 모인다.
// (2026-08-03 실측: 지역명 없이 "카페 노트북 콘센트"로 찾으면 30건 중 해당 지역이 2건뿐이었다.)
// 한국어로 장소를 물을 땐 지역을 앞에 두고 접미사를 안 붙인다 — "가평 한정식", "강남 브런치".
// 접미사(시·군·구·동…)만 찾으면 "가평"을 통째로 놓친다.
const SUFFIX_RE = /([가-힣]{2,7}(?:특별시|광역시|시|군|구|읍|면|동|리|역))(?![가-힣])/;
const NOISE = /^(어머니|아버지|부모님|혼자|친구|가족|근처|여기|우리|오늘|내일|주말|점심|저녁|아침)$/;
function pickRegion(q) {
  const suf = q.match(SUFFIX_RE);
  if (suf) return suf[1];
  // 접미사가 없으면 첫 어절을 지역 후보로 본다. 음식 종류나 사람 얘기면 지역이 아니다.
  const first = q.trim().split(/[\s,·]+/)[0]?.replace(/(에서|으로|에|의|은|는|이|가|로)$/, '') || '';
  if (first.length >= 2 && first.length <= 6 && !NOISE.test(first)
      && !/한정식|카페|맛집|국수|고기|정식|밥집|식당/.test(first)) return first;
  return '';
}

function esc(s) { return String(s).replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c])); }

async function search() {
  const q = $('#q').value.trim();
  const n = $('#notice');
  const btn = $('#goBtn');
  if (!q) { $('#q').focus(); return; }

  const region = pickRegion(q);
  if (!region) {
    n.hidden = false;
    n.innerHTML = `<b>어디 근처인지 알려줘.</b>
      <span>조건에 지역을 같이 써줘 — 예: <b>가평</b> 한정식, 어머니 모시고.
      네이버 지역 검색은 지역명이 없으면 전국에서 아무 데나 물어와.</span>`;
    return;
  }

  btn.disabled = true;
  const label = btn.textContent;
  btn.textContent = '블로그 읽는 중…';
  n.hidden = false;
  n.innerHTML = `<b>"${esc(region)}" 근처에서 찾는 중</b>
    <span>지역 검색으로 후보를 잡고, 블로그 본문을 열어 조건별 근거를 뽑고 있어. 10초쯤 걸려.</span>`;

  try {
    const p = new URLSearchParams({ q, region });
    if (state.origin) { p.set('lat', state.origin.lat); p.set('lng', state.origin.lng); }
    const r = await fetch(`/api/search?${p}`);
    const d = await r.json();
    if (!r.ok || d.error) throw new Error(d.error || `HTTP ${r.status}`);

    if (!d.places?.length) {
      n.innerHTML = `<b>"${esc(region)}"에서 못 찾았어.</b>
        <span>지역명을 더 넓게(예: 면·읍 대신 시·군) 써보거나, 음식 종류를 같이 적어줘.</span>`;
      return;
    }

    // 서버가 준 좌표에 내 위치 기준 거리를 입힌다.
    state.places = d.places.map((x) => ({
      id: x.name, name: x.name, kind: x.kind, addr: x.addr, lat: x.lat, lng: x.lng,
      tel: x.tel || null,
      priceLow: x.priceLow, priceHigh: x.priceHigh,
      priceNote: x.priceLow ? null : '가격 미확인',
      evidence: x.evidence.map((e) => ({ k: e.k, q: e.q, url: e.url, date: e.date })),
      warn: [
        ...x.warn.map((w) => `${w.q} (${w.date})`),
        ...(x.missing.length ? [`미확인: ${x.missing.join(', ')}`] : []),
      ],
      photos: [],
    }));

    n.innerHTML = `<b>"${esc(q)}"</b>
      <span>조건 <b>${d.asked.join(' · ') || '없음'}</b> 기준으로 ${d.places.length}곳.
      각 항목의 인용은 실제 블로그 본문에서 뽑았고 날짜·링크가 붙어 있어.</span>`;
    render();
    $('#results').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (e) {
    n.innerHTML = `<b>검색이 실패했어.</b><span>${esc(e.message)} — 잠시 뒤 다시 눌러줘.</span>`;
  } finally {
    btn.disabled = false;
    btn.textContent = label;
  }
}

/* ── 초기화 ── */
function bindMode() {
  document.querySelectorAll('#modeSeg button').forEach((b) => {
    b.addEventListener('click', () => {
      state.mode = b.dataset.mode;
      document.querySelectorAll('#modeSeg button').forEach((x) =>
        x.setAttribute('aria-pressed', String(x === b)));
      const m = MODES[state.mode];
      const r = $('#rad');
      r.max = m.max; r.step = m.step;
      state.minutes = Math.min(state.minutes, m.max);
      r.value = state.minutes;
      $('#radOut').textContent = `${m.label} ${state.minutes}분`;
      render();
    });
  });
  $('#rad').addEventListener('input', (e) => {
    state.minutes = +e.target.value;
    $('#radOut').textContent = `${MODES[state.mode].label} ${state.minutes}분`;
    render();
  });
}

async function init() {
  bindMode();
  $('#locBtn').addEventListener('click', locate);
  $('#goBtn').addEventListener('click', search);
  document.querySelectorAll('#pickFallback button').forEach((b) =>
    b.addEventListener('click', () =>
      setOrigin(+b.dataset.lat, +b.dataset.lng, b.textContent)));
  $('#radOut').textContent = `${MODES.car.label} ${state.minutes}분`;

  try {
    const r = await fetch('data/places.json', { cache: 'no-cache' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    state.places = (await r.json()).places;
  } catch (e) {
    $('#results').innerHTML =
      `<p class="empty">장소 데이터를 못 불러왔어 (${e.message})<br>새로고침해봐</p>`;
    return;
  }
  render();   // 위치를 못 잡아도 안내는 뜨게
  locate();
}
document.addEventListener('DOMContentLoaded', init);
