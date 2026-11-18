# BÁO CÁO CUỐI KỲ — NEOSCOPE

## Phòng phân tích thanh khoản & vi cấu trúc thị trường chứng khoán Việt Nam

**Học phần:** Gói phần mềm ứng dụng cho tài chính 1 (261BFF401101, 261BFF401102)
**Đề tài:** Thử thách đổi mới công nghệ tài chính với NEO API — nguồn thay thế được duyệt: **SSI FastConnect API v3**
**Mã nguồn:** https://github.com/thanhntm2202/neoapi.scope
**Môi trường dữ liệu kiểm chứng:** bộ sinh dữ liệu mô phỏng có kiểm soát (10 phiên, 8 mã, seed cố định, luôn gắn nhãn SYNTHETIC)

> **Tuyên bố phạm vi an toàn:** Sản phẩm chỉ sử dụng dữ liệu và chức năng **không phát sinh giao dịch tiền thật**. Toàn bộ mã nguồn không chứa và không bao giờ khởi tạo client đặt/sửa/hủy lệnh của SSI hay NEO. Mọi con số chi phí là **mô phỏng học thuật**, không phải khuyến nghị đầu tư.

---

## 1. Tóm tắt điều hành

Nhà đầu tư tổ chức và chuyên viên môi giới tại Việt Nam thường xuyên phải trả lời ba câu hỏi mà bảng giá thông thường không trả lời được: *(i)* mã này hiện "khỏe" về thanh khoản đến đâu so với chính nó trong ngày và so với nhóm? *(ii)* một lệnh giả định quy mô X tỷ đồng sẽ chịu chi phí thực thi khoảng bao nhiêu, và ước tính đó đáng tin ở mức nào? *(iii)* điều gì vừa xảy ra là bất thường — bốc hơi độ sâu, bùng nổ khối lượng, hay mất cân bằng sổ lệnh?

**NeoScope** trả lời cả ba bằng một pipeline hoàn chỉnh: ghi luồng thị trường thời gian thực qua **SSI FastConnect API v3** (WebSocket `quote/trade/room/market/indexsummary/marketflag`, kèm nhóm REST `DailyOHLCHistory` + `Securities`), chuẩn hóa-append-only với manifest SHA-256, tính chỉ báo vi cấu trúc (spread, độ sâu, OBI, ILLIQ, biến động), tổng hợp **Liquidity Health Score (LHS)** 5 cấu phần, mô phỏng chi phí theo **Implementation Shortfall** (Perold 1988; Almgren et al. 2005), cảnh báo bất thường bằng **ngưỡng thống kê suy từ dữ liệu** (baseline expanding theo mã × khung giờ, cổng z + phân vị 99%), và kiểm chứng toàn bộ bằng **walk-forward 5 folds + bootstrap theo cụm phiên**.

Kết quả ngoài mẫu trên bộ dữ liệu mô phỏng 10 phiên (216.165 snapshot, 2.400 lệnh test giả lập): mô hình đầy đủ đạt MAE **1,92 bps** so với 17,20 bps của naive-mid và 2,16 bps của ladder-only; ở chế độ lệnh **vượt sổ hiển thị** (167 lệnh) — nơi giá trị thật nằm — mô hình full vượt benchmark −1,73 bps, CI95 [−2,26; −1,27]; độ phủ khoảng dự báo 90% đạt 98,5% (Wilson CI [97,6%; 99,0%]). Đây là bằng chứng kiểm chứng *cơ chế* trên thế giới mô phỏng có chủ đích, được công bố trung thực kèm giới hạn — không phải bằng chứng hiệu quả ngoài đời thật.

## 2. Vấn đề và nhu cầu người dùng

**Bối cảnh.** Thị trường chứng khoán Việt Nam giao dịch theo cơ chế sổ lệnh điện tử với khung giá ±7% (HOSE), thanh khoản phân hóa mạnh giữa cổ phiếu VN30 và midcap, và biến động thanh khoản hình chữ U nội ngày. Ba nhóm người dùng có nhu cầu thực tế:

- **Nhà đầu tư / quản trị rủi ro** — cần nhận diện sớm rủi ro thanh khoản (độ sâu bốc hơi, spread giãn) trước khi thực hiện lệnh lớn.
- **Chuyên viên môi giới / giao dịch viên** — cần ước tính chi phí tác động thị trường cho lệnh khách hàng thay vì đoán theo kinh nghiệm.
- **Nhà phân tích / nghiên cứu vi cấu trúc** — cần dữ liệu tick chuẩn hóa, có truy vết, để xây dựng và kiểm chứng giả thuyết.

**Khó khăn hiện tại.** Dữ liệu sổ lệnh ba mức phát qua WebSocket chỉ là "ảnh chụp" tức thời; không có công cụ phổ thông giúp người dùng tổng hợp thành điểm số so sánh được, mô phỏng chi phí có kiểm chứng ngoài mẫu, hay cảnh báo có bằng chứng truy nguyên. **Giá trị kỳ vọng của NeoScope:** biến luồng dữ liệu thô thành quyết định có cơ sở — với một bộ dữ liệu tái lập được và bằng chứng định lượng cho mức độ tin cậy của từng con số.

## 3. Thiết kế sản phẩm

### 3.1 Sơ đồ kiến trúc

```text
┌─────────────────────────────────────────────────────────────────────────┐
│ NGUỒN DỮ LIỆU                                                          │
│  SSI FastConnect API v3 (nguồn cốt lõi, được duyệt thay NEO)          │
│   ├─ WebSocket: quote · trade · room · market · indexsummary · flag      │
│   └─ REST: DailyOHLCHistory · Securities (OAuth2, token-bucket 5 RPS)  │
│  NEO API (nguồn dự phòng có chủ đích, tách biệt hoàn toàn)             │
│  Bộ sinh SYNTHETIC (seed cố định, gắn nhãn công khai)                 │
└──────────────┬──────────────────────────────────────────────────────────┘
               ▼
┌──────────────────────────────┐   ┌────────────────────────────────────┐
│ THU THẬP (recorder)          │   │ CHUẨN HÓA / LƯU TRỮ               │
│ · hàng đợi bounded 10.000    │──▶│ · RAW append-only JSONL.gz         │
│ · watchdog mất im lặng       │   │ · manifest SHA-256 + config_hash │
│ · dừng capture nếu quá tải   │   │ · cờ chất lượng (dedup, muộn,     │
│   (không âm thầm mất tick)   │   │   lỗi kiểu, thiếu trường, NO_BOOK) │
└──────────────┬───────────────┘   └───────────────┬────────────────────┘
               ▼                                   ▼
┌───────────────────────────────────────────────────────────────────────┐
│ LOGIC TÀI CHÍNH (finance/)                                             │
│  · microstructure: spread bps, depth VND, OBI, mid, Amihud ILLIQ      │
│  · liquidity: resilience episodes (phục hồi độ sâu sau sốc KL)          │
│  · execution: Implementation Shortfall = quét sổ 3 mức (tất định)     │
│    + trôi giá κ·OBI·τ + rủi ro thời điểm σ√τ (Almgren et al. 2005)    │
└──────────────┬────────────────────────────────────────────────────────┘
               ▼
┌───────────────────────────────────────────────────────────────────────┐
│ PHÂN TÍCH / MÔ HÌNH (analytics/)                                       │
│  · LHS = 100 × trung bình hạng percentile chéo mã của 5 cấu phần     │
│    (độ chặt, độ sâu, tức thời, ổn định, cân bằng), cửa sổ trượt 15'  │
│  · Cảnh báo: baseline expanding mã × bucket 15' |z|≥3 ∧ pct≥99%        │
│    ∧ dai dẳng ≥3 tick ∧ cooldown 60s → P1/P2/P3 theo đuôi phân phối   │
│  · Walk-forward 5 folds · bootstrap theo cụm phiên · Wilson CI        │
└──────────────┬────────────────────────────────────────────────────────┘
               ▼
┌───────────────────────────────────────────────────────────────────────┐
│ GIAO DIỆN (Streamlit, design system tối thống nhất)                   │
│  Tổng quan · Thanh khoản (LHS + Radar) · Mô phỏng chi phí · Cảnh báo  │
│  Kiểm chứng · Dữ liệu & chất lượng · Phương pháp & giới hạn           │
└───────────────────────────────────────────────────────────────────────┘
```

### 3.2 Lựa chọn công nghệ và lý do

| Lớp | Lựa chọn | Lý do |
|---|---|---|
| Ngôn ngữ | Python 3.11+ (bắt buộc của đề) | Hệ sinh thái khoa học dữ liệu tài chính mạnh nhất |
| Nguồn dữ liệu | SSI FastConnect API v3 (SDK `ssi-sdk==3.3.2` cho stream; client REST tự viết) | Neo API bị lỗi; giảng viên duyệt SSI là nguồn thay thế hoàn toàn; SDK v3 là bản mới nhất trên portal |
| Giao diện | Streamlit + Plotly | Tương tác tốt, dễ chạy cho người chấm; Plotly cho đồ thị chuyên sâu có tooltip |
| Lưu trữ | JSONL.gz (RAW) + Parquet (curated) | RAW append-only có thể audit; Parquet nén tốt cho phân tích cột |
| Kiểm thử | pytest 173 test | Bao phủ logic tài chính, chuẩn hóa, hỗn loạn (chaos), an toàn |

### 3.3 Điểm khác biệt so với "bảng giá nâng cấp"

Mỗi màn hình trả lời **một câu hỏi quyết định**, kết thúc bằng diễn giải có trách nhiệm: LHS giải thích *vì sao* mã khỏe/yếu (phân rã 5 cấu phần + radar so hai mã); mô phỏng chi phí công bố *toàn bộ* tham số fold và giả định, đối chiếu với buồng thử khớp lệnh giấy; cảnh báo mang theo *bằng chứng đầy đủ* (z, phân vị, số quan sát baseline) và truy nguyên trên đồ thị; trang kiểm chứng đưa cả điểm yếu lên giao diện thay vì giấu.

## 4. Dữ liệu SSI FastConnect API v3

### 4.1 Endpoint và luồng sử dụng

| Nhóm | Endpoint/luồng | Biến khai thác | Vai trò trong bài toán |
|---|---|---|---|
| Stream | `quote` | 5 mức bid/ask (giá nghìn đ → VND ×1000), KL từng mức | Spread, độ sâu, OBI, quét sổ — **trung tâm ý tưởng 3+4** |
| Stream | `trade` | giá, O/H/L, giá bình quân, KL lũy kế | ILLIQ, biến động, khớp lệnh mô phỏng |
| Stream | `room` | room ngoại, room còn lại | Biến động dòng tiền ngoại (giữ RAW, chưa suy diễn ngữ nghĩa mua/bán) |
| Stream | `indexsummary` | điểm số, %, tổng KL/giá trị, số mã tăng/giảm/trần/sàn, trạng thái phiên | Độ rộng thị trường — ý tưởng 1 bổ trợ |
| Stream | `marketflag` | cờ phiên (ATO/ATC/LO…) | Gắn nhãn chế độ, loại trừ snapshot sổ vô nghĩa |
| REST | `DailyOHLCHistory` | OHLCV ngày | Bối cảnh dài hạn, kiểm tra lệch đơn vị giá |
| REST | `Securities` | danh mục CK, lot | Hợp lệ hóa watchlist trước subscribe |

**Tần suất:** token-bucket 5 request/giây cho mọi lần gọi REST (đếm và báo cáo qua `compliance_report()`); dữ liệu thời gian thực ưu tiên WebSocket, không lặp REST. **Múi giờ:** mọi dấu thời gian chuẩn hóa về `Asia/Ho_Chi_Minh` (UTC+7); thời điểm sự kiện theo nguồn, khi thiếu thì fallback `arrival_ts` và gắn cờ.

### 4.2 Quy trình lưu trữ, làm sạch và từ điển dữ liệu

RAW ghi append-only theo topic (`ssi_quote`, `ssi_trade`, …), kèm `seq`, `arrival_ts`, `config_hash`; khi đóng phiên, manifest ghi SHA-256 từng tệp và số thông điệp — người chấm tái lập toàn bộ curated bằng `neoscope process --force`. Tầng chuẩn hóa ép kiểu phòng thủ (giá chuỗi "29.85", null ATO/ATC), **không điền giá trị bịa**, gắn cờ chất lượng: `DUPLICATE`, `LATE`, `OUT_OF_ORDER`, `MISSING_FIELD`, `TYPE_ERROR`, `NO_BOOK`, `STALE_GAP`. Trường ngoại mua/bán của SSI giữ nguyên trong RAW vì hợp đồng hiện hành không ghi rõ ngữ nghĩa tích lũy — minh chứng nguyên tắc "không trình bày vượt quá dữ liệu". Bộ dữ liệu kiểm chứng: 10 phiên × 8 mã × nhịp 5 giây = 217.049 thông điệp RAW → 216.165 snapshot curated (884 bản ghi lặp bị loại, đếm công khai ở trang Dữ liệu & chất lượng).

## 5. Phương pháp tài chính và phân tích

### 5.1 Chỉ báo vi cấu trúc (ý tưởng 3 — bộ đo thanh khoản; ý tưởng 4 — mất cân bằng sổ lệnh)

- **Quoted spread (bps):** `(ask1 − bid1) / mid × 10⁴` — chi phí tức thời; độ chặt của thị trường tạo lập.
- **Displayed depth (VND):** `Σ price_i × volume_i` hai phía — khả năng hấp thụ hiển thị; *không* phải thanh khoản ẩn.
- **OBI (Order Book Imbalance):** `(ΣbidVol − ΣaskVol)/(ΣbidVol + ΣaskVol)` ∈ [−1, 1] — áp lực mua/bán; theo Cont, Kukanov & Stoikov (2014) có sức dự báo hướng giá ngắn hạn.
- **Amihud ILLIQ:** `|r| / giá trị giao dịch` — tức thời theo từng nhịp; kỳ vọng âm với LHS tương lai.
- **Resilience:** thời gian phục hồi độ sâu sau nhịp khối lượng cao — rủi ro thanh khoản động.

### 5.2 LHS — điểm sức khỏe thanh khoản tổng hợp

Mỗi cấu phần (độ chặt, độ sâu, tức thời, ổn định spread, cân bằng) được xếp **hạng percentile chéo các mã trong cùng thời điểm** (trung vị cửa sổ trượt 15 phút), rồi lấy trung bình có trọng số ×100. Chọn hạng thay vì giá trị thô vì các cấu phần khác đơn vị; trọng số mặc định đều 1,0 và **độ nhạy trọng số được kiểm chứng** (nhân đôi từng trọng số, Spearman thứ hạng với LHS gốc ≥ 0,74 trong cấu hình hiện tại). Giá trị xây dựng: Spearman(LHS_t, ILLIQ tương lai 15') = **−0,789** trung bình các phiên test (âm mạnh, đúng kỳ vọng lý thuyết: thanh khoản cao → ma sát tương lai thấp).

### 5.3 Mô hình chi phí thực thi (Implementation Shortfall)

`E[IS] = w_vis·(quét 3 mức hiển thị) + w_res·(½spread + κ·OBI·τ) + w_unf·(chi phí cơ hội phần chưa khớp)`, với κ ước lượng **walk-forward** theo nhóm cổ phiếu (không fit trên phiên đang xem), τ từ tỷ lệ tham gia 15% và hồ sơ khối lượng theo bucket giờ. Khoảng dự báo 90% dùng σ trailing + hiệu chỉnh ngoài mẫu. Giả định công bố: tiếp cận toàn bộ KL hiển thị, không own-impact → lệnh rất lớn là **cận dưới** chi phí.

### 5.4 Cảnh báo bất thường thông minh (ý tưởng 6+7)

Baseline **expanding theo mã × bucket 15 phút** tôn trọng hình chữ U nội ngày; kích hoạt khi `|z| ≥ 3` **và** phân vị thực nghiệm ≥ 99% **và** dai dẳng ≥ 3 tick, cooldown 60s chống trùng. Năm loại: `SPREAD_WIDEN`, `DEPTH_EVAPORATION`, `OBI_EXTREME`, `TRADE_BURST`, `FOREIGN_BURST`. Ưu tiên P1/P2/P3 = đuôi phân phối lịch sử ≥ 99,9%/99,5%/99% — là *mức sàng lọc*, không phải xác suất tổn thất. Mỗi cảnh báo hiển thị z, phân vị, số quan sát baseline và truy nguyên trên đồ thị 3 tầng (giá/độ sâu/khối lượng). Trên bộ mô phỏng có cài sự kiện ground-truth, cơ chế đạt precision/recall được đo công khai (dung khớp ±30s) — kiểm chứng cơ chế, không phải hiệu quả thật.

## 6. Triển khai sản phẩm

### 6.1 Giao diện

Bảng điều khiển tối chuẩn fintech (design system tối nhất quán: hero banner, status pill, KPI card, Alert Pulse feed), bảy trang:

1. **Tổng quan** — KPI phiên (spread trung vị, độ sâu, LHS, số cảnh báo P1/P2), Alert Pulse (6 cảnh báo mới nhất), độ rộng thị trường, xếp hạng LHS, bảng watchlist, phạm vi sử dụng.
2. **Thanh khoản** — xếp hạng LHS tại thời điểm chọn, phân rã cấu phần, **Liquidity Radar so hai mã**, diễn biến LHS, độ nhạy trọng số.
3. **Mô phỏng chi phí** — lệnh giả định 50 triệu–5 tỷ đồng: IS kỳ vọng, khoảng dự báo 90%, thang sổ lệnh, waterfall chi phí, đối chiếu benchmark, **buồng thử khớp lệnh giấy** tự đối chiếu dự báo–thực hiện.
4. **Cảnh báo** — bộ lọc phiên/loại/mã/ưu tiên, bảng bằng chứng, truy nguyên đồ thị, precision/recall ground-truth (SYNTHETIC).
5. **Kiểm chứng** — MAE/RMSE/bias ngoài mẫu theo mô hình và theo chế độ phủ sổ, scatter dự báo–thực hiện, CI bootstrap, độ phủ PI + Wilson, IC của LHS, ngũ phân vị OBI, resilience, giới hạn trung thực.
6. **Dữ liệu & chất lượng** — heatmap cờ theo phiên, sổ cái pipeline, manifest SHA-256, từ điển dữ liệu theo provider.
7. **Phương pháp & giới hạn** — toàn bộ công thức, ngưỡng, giao thức kiểm chứng.

Trạng thái dữ liệu minh bạch ở mọi tầng: thời điểm cập nhật gần nhất, trạng thái WebSocket (connected/stale/failed + số thông điệp + độ sâu hàng đợi + lỗi callback), nhãn SYNTHETIC, múi giờ. Trạng thái rỗng/lỗi/mất kết nối đều có hướng dẫn xử lý thay vì để trang trắng.

### 6.2 Quy trình sử dụng (demo cho người chấm)

```powershell
pip install -e .
neoscope --mode SYNTHETIC all --force   # sinh 10 phiên mô phỏng → chuẩn hóa → phân tích → kiểm chứng
neoscope --mode SYNTHETIC app           # mở dashboard ở localhost:8501
pytest                                  # 173 kiểm thử tự động, không cần mạng
```

Với SSI LIVE: điền `SSI_CLIENT_ID/API_KEY/API_SECRET` vào `.env`, `NEOSCOPE_MODE=LIVE`, rồi `neoscope record` trong giờ giao dịch → `process` → `analyze` → `validate` → `app`; lịch sử OHLC dài hạn bằng `neoscope history --from-date … --to-date …`.

## 7. Kiểm thử và kết quả

### 7.1 Kế hoạch thử nghiệm

| Lớp thử | Phương pháp | Bằng chứng |
|---|---|---|
| Đơn vị logic tài chính | pytest: tính tay trên chuỗi snapshot thủ công (spread, OBI, ILLIQ, quét sổ, IS) | `tests/test_microstructure.py`, `test_liquidity.py`, `test_execution.py` |
| Chuẩn hóa & "bẫy" dữ liệu | payload null, chuỗi số, lặp, muộn, sai thứ tự, thiếu trường | `tests/test_normalize_traps.py`, `test_store_and_bars.py` |
| Tần suất & retry | token-bucket, 429/5xx backoff | `tests/test_rate_limiter.py` |
| Adapter SSI | parser token phòng thủ, phân trang, dedup, 401-refresh, ràng buộc "không có endpoint giao dịch" (quét tĩnh) | `tests/test_ssi_rest.py`, `test_ssi_adapter.py` |
| Hỗn loạn (chaos) | ngắt kết nối, dữ liệu đến dồn, hàng đợi bão hòa → capture phải dừng *có báo cáo* | `tests/test_chaos.py`, `chaos_scenarios.py` |
| An toàn | không credential trong mã/manifest/log; không có lệnh thật | `tests/test_safety.py` |
| Tái lập | replay RAW → curated giống hệt | `tests/test_replay.py` |

### 7.2 Kết quả định lượng ngoài mẫu (SYNTHETIC, 10 phiên)

| Mô hình | MAE (bps) | RMSE | Bias | n |
|---|---|---|---|---|
| naive_mid | 17,20 | 21,03 | −16,64 | 1.200 |
| ladder_only | 2,16 | 8,23 | +1,17 | 1.200 |
| **full** | **1,92** | **7,33** | **+0,03** | 1.200 |

- ΔMAE full−ladder toàn mẫu: **−0,24 bps**, CI95 [−0,32; −0,16]; chỉ lệnh **vượt sổ** (n=167): **−1,73 bps**, CI95 [−2,26; −1,27] — bằng chứng then chốt vì lệnh trong sổ có realized == ladder một cách tất định (đã tách bạch, không "khoe" sai số ≈ 0).
- Độ phủ PI 90%: **98,5%**, Wilson CI [97,6%; 99,0%] — hơi cao hơn danh nghĩa do lệnh trong sổ có PI suy biến; phân rã theo chế độ được trình bày riêng.
- Giá trị xây dựng LHS: Spearman với ILLIQ tương lai **−0,789**; OBI ngũ phân vị đơn điệu với lợi nhuận phút kế tiếp ngoài mẫu.
- Độ nhạy trọng số LHS: Spearman thứ hạng ≥ 0,74 khi nhân đôi từng trọng số.
- Chất lượng dữ liệu: 217.049 RAW → 216.165 curated; 884 lặp loại; mọi cờ đếm công khai theo phiên.

### 7.3 Các trường hợp lỗi đã thử

Mất kết nối 20–60s (gap event), thông điệp muộn 3–10s, sai thứ tự, lặp 0,4%, thiếu trường mức 3, `totalBidQTTY` null (thấy trong payload mẫu NEO docs), hàng đợi ingest bão hòa (dừng capture failed thay vì bỏ tick âm thầm), 429/5xx (backoff), 401 (refresh token đúng một lần). Ứng dụng không treo ở bất kỳ trường hợp nào; trạng thái lỗi hiển thị kèm nguyên nhân.

## 8. Hạn chế và sử dụng có trách nhiệm

1. **Dữ liệu kiểm chứng là mô phỏng.** Kết quả Mục 7.2 chứng minh cơ chế hoạt động đúng trên thế giới có ground-truth; chưa phải bằng chứng hiệu quả trên thị trường thật. Cần ≥5–10 phiên LIVE qua SSI FastConnect để tái ước lượng κ, Y và độ phủ PI.
2. **Sổ ba mức là ảnh chụp** — không thấy hàng đợi, lệnh ẩn, own-impact; chi phí lệnh lớn là cận dưới.
3. **Công suất thống kê:** 5 cụm phiên test → CI rộng là trung thực, không phải lỗi kỹ thuật.
4. **Ngữ nghĩa trường ngoại của SSI** chưa được xác nhận → giữ RAW, loại khỏi flow tích lũy.
5. **Sản phẩm không dùng để:** đặt lệnh thật, dự báo giá dài hạn, đưa khuyến nghị mua/bán, hay kết luận nhân quả từ cảnh báo. Đây là **công cụ phân tích học thuật**.
6. **Bảo mật:** credential chỉ từ biến môi trường; OTP (nếu entitlement yêu cầu) chỉ đọc từ env, không ghi manifest/log; mọi capture có SHA-256 để phát hiện can thiệp.

## 9. Hướng phát triển

- Chạy capture LIVE SSI 10+ phiên và tái lập toàn bộ kiểm chứng ngoài mẫu trên dữ liệu thật (đường ống đã sẵn: `record → process → analyze → validate`).
- Mở rộng cảnh báo sang học máy (phát hiện bất thường bán giám sát trên đặc trưng vi cấu trúc) khi đủ dữ liệu, vẫn giữ walk-forward.
- Ước lượng thanh khoản ẩn (hidden liquidity) và mô hình hàng đợi khi tiếp cận được dữ liệu cấp lệnh.
- Phái sinh–cơ sở (ý tưởng 10) khi được cấp entitlement phái sinh của SSI.
- Trợ lý giải thích (ý tưởng 14) có kiểm chứng nguồn, không thay thế phương pháp tài chính.

## 10. Kết luận

NeoScope chứng minh một chuỗi giá trị hoàn chỉnh — từ luồng thô của SSI FastConnect API v3 đến quyết định có bằng chứng: ghi có truy vết, chuẩn hóa không bịa, đo lường có cơ sở lý thuyết (Perold; Almgren; Amihud; Cont et al.), cảnh báo có ngưỡng thống kê biện giải, và kiểm chứng ngoài mẫu có tách rò rỉ, bootstrap đúng đơn vị, công bố cả điểm yếu. Bài học kỹ thuật lớn nhất: **độ tin cậy của một con số tài chính nằm ở khả năng tái lập và kiểm chứng, không nằm ở độ phức tạp của mô hình**. Bài học tài chính lớn nhất: ở chế độ vượt sổ hiển thị — nơi nhà đầu tư tổ chức thật sự mất tiền — điều kiện sổ lệnh quan sát được (OBI, σ, hồ sơ khối lượng) mang giá trị dự báo đo được, và đó chính là giá trị cốt lõi sản phẩm.

## Phụ lục

- **A. Từ điển dữ liệu:** xem trang "Dữ liệu & chất lượng" của dashboard và `docs/provider_contracts.md`, `docs/ssi_fastconnect.md`.
- **B. Công thức chi tiết & biện giải ngưỡng:** `docs/methodology.md`, `docs/thresholds.md`.
- **C. Hướng dẫn cài đặt & chạy:** `README.md` (cài `pip install -e .`, `.env` từ `.env.example`, `neoscope --mode SYNTHETIC all --force`, `neoscope --mode SYNTHETIC app`).
- **D. Kiểm thử:** `pytest` — 173 test; kịch bản hỗn loạn `tests/chaos_scenarios.py`.
- **E. Mã nguồn & video demo:** https://github.com/thanhntm2202/neoapi.scope (nhánh main; video demo nộp kèm theo quy cách `MSSV_HoTen_Demo.mp4`).

## Tài liệu tham khảo

1. Perold, A. (1988). *The Implementation Shortfall: Paper versus Reality.* Journal of Portfolio Management.
2. Almgren, R., Thum, C., Hauptmann, E., Li, H. (2005). *Direct Estimation of Equity Market Impact.* Risk.
3. Amihud, Y. (2002). *Illiquidity and Stock Returns: Cross-section and Time-series Effects.* Journal of Financial Markets.
4. Cont, R., Kukanov, A., Stoikov, S. (2014). *The Price of Immediacy.* Journal of Financial Econometrics.
5. SSI Securities — FastConnect API v3 documentation: https://developers.ssi.com.vn (system overview; Python SDK; WebSocket market-data fields).
6. VPBankS NEO API documentation (nguồn dự phòng): https://neoinvest.vpbanks.com.vn/neo-openapi/docs/overview.
7. Đề thi cuối kỳ — Thử thách đổi mới công nghệ tài chính với NEO API, Học kỳ 1 năm học 2026–2027, Trường ĐH Kinh tế – Luật.
