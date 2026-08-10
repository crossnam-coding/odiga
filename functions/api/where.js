// GET /api/where?lat=&lng= — 좌표가 어느 동네인지.
// 위치를 잡자마자 화면에 "가평 근처"라고 보여주기 위한 것.
// 어디로 인식됐는지 안 보여주면, 결과가 이상할 때 위치 탓인지 검색 탓인지 알 수 없다.

export async function onRequestGet({ request }) {
  const u = new URL(request.url);
  const lat = parseFloat(u.searchParams.get('lat'));
  const lng = parseFloat(u.searchParams.get('lng'));
  const json = (b, s = 200) => new Response(JSON.stringify(b), {
    status: s,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=600' },
  });
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return json({ error: '좌표가 없어' }, 400);

  try {
    const r = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&zoom=12&accept-language=ko&lat=${lat}&lon=${lng}`,
      { headers: { 'User-Agent': 'odiga/1.0 (https://odiga-eyf.pages.dev)' } });
    // 여기가 실패하면 "위치가 꺼져 있어" 로만 보여서 원인이 안 드러난다(2026-08-10 로그 신설).
    // 좌표는 소수점 둘째 자리까지만 남긴다 — 로그로 집을 특정할 수 있으면 안 된다.
    const at = `${lat.toFixed(2)},${lng.toFixed(2)}`;
    if (!r.ok) {
      console.error(JSON.stringify({ ev: 'where_http', status: r.status, at }));
      return json({ error: `역지오코딩 ${r.status}` }, 502);
    }
    const a = (await r.json()).address || {};
    const wide = a.city || a.county || a.province || a.state || '';
    const near = a.town || a.borough || a.city_district || a.suburb || a.quarter || '';
    const region = (wide || near).replace(/(특별시|광역시|자치시|자치도)$/, '').replace(/(시|군|구)$/, '');
    if (!region) console.log(JSON.stringify({ ev: 'where_empty', at, keys: Object.keys(a).slice(0, 8) }));
    return json({ region: region || null, wide: wide || null, near: near || null });
  } catch (e) {
    console.error(JSON.stringify({ ev: 'where_fail',
      at: `${lat.toFixed(2)},${lng.toFixed(2)}`, err: String(e.message || e) }));
    return json({ error: String(e.message || e) }, 502);
  }
}
