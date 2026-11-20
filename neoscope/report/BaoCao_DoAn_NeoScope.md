# BÁO CÁO ĐỒ ÁN CÁ NHÂN CUỐI KỲ
## THỬ THÁCH ĐỔI MỚI CÔNG NGHỆ TÀI CHÍNH VỚI NEO API (CHUYỂN ĐỔI SANG SSI FASTCONNECT DỰ PHÒNG THEO QUY ĐỊNH ĐỀ BÀI)

**Tên sản phẩm:** NeoScope — Bàn làm việc phân tích vi cấu trúc thị trường & mô phỏng chi phí thực thi chứng khoán Việt Nam (HOSE)  
**Chế độ mặc định hiện tại:** `SYNTHETIC` (có sẵn lớp kết nối `LIVE` cho SSI FastConnect API v3 REST + WebSocket và adapter dự phòng VPBankS NEO API)  
**Cấu hình chuẩn tái lập (`config_hash`):** `04c3812c60446fad` · Múi giờ chuẩn: `Asia/Ho_Chi_Minh` (UTC+7)

---

## 1. Tóm tắt điều hành (Executive Summary)

Trên thị trường chứng khoán Việt Nam (đặc biệt là sàn HOSE với quy mô lô tối thiểu 100 cổ phiếu và bước giá biến đổi theo mệnh giá), nhà đầu tư cá nhân nâng cao, chuyên viên môi giới tư vấn (broker) và chuyên viên phân tích thường gặp hai khoảng trống thông tin nghiêm trọng:

1. **Ảo giác thanh khoản từ giá khớp gần nhất (last price / mid-price):** Khi đặt lệnh quy mô lớn (500 triệu – 5 tỷ VND), chi phí thực tế không nằm ở chênh lệch giá tham chiếu mà nằm ở việc *quét xuyên qua 3 mức giá hiển thị trên sổ lệnh (Order Book)* và rủi ro trượt giá phần khối lượng dư thực thi kéo dài sau đó. Các bảng giá thông thường không định lượng được phần chi phí ẩn này.
2. **Nhiễu cảnh báo thanh khoản nội ngày:** Độ rộng chênh lệch giá mua/bán (spread) và độ sâu sổ lệnh trên HOSE biến thiên theo hình chữ U trong phiên (giãn lúc mở/đóng cửa, dày ở giữa phiên) và phân hóa mạnh giữa nhóm vốn hóa lớn (VN30) với nhóm midcap thanh khoản mỏng. Các ngưỡng cảnh báo cố định gây ra báo động giả hàng loạt.

**NeoScope** giải quyết trực diện hai vấn đề trên bằng một workbench phân tích **chỉ đọc (read-only)**, kết hợp nguồn dữ liệu thời gian thực từ **SSI FastConnect API v3** (hoặc **VPBankS NEO API**) với lớp logic tài chính định lượng gồm:
- **Chỉ số sức khỏe thanh khoản tổng hợp LHS (0–100)** từ 5 cấu phần vi cấu trúc (`tightness`, `depth`, `immediacy`, `stability`, `balance`), kèm phòng thí nghiệm điều chỉnh trọng số theo chiến lược đầu tư (*What-If Sandbox*) đo độ ổn định thứ hạng qua Spearman $\rho$.
- **Mô hình ước tính chi phí thực thi Implementation Shortfall (IS)** kết hợp quét sổ 3 mức tất định (deterministic ladder sweep) + phần dư bất định ($\kappa \cdot \text{OBI}$ và rủi ro thời điểm $\sqrt{\tau}$) hiệu chỉnh *ngoài mẫu (out-of-sample)* bằng **walk-forward 5 folds**, đi kèm **bộ so sánh chia nhỏ lệnh 1 / 2 / 4 / 8 đợt** tách biệt rõ tác động thị trường với phí môi giới (0.15%) và thuế bán (0.1%).
- **Hệ thống cảnh báo bất thường đa chiều theo ngưỡng thống kê bền vững (Robust Z-score dùng MAD = 1.4826 × median|x − med|, chuẩn hóa theo khung 15 phút nội ngày)** gắn cầu nối trực tiếp sang mô phỏng chi phí tại chính thời điểm xảy ra cảnh báo.

Trên tập kiểm chứng 10 phiên chuẩn (`216,165` snapshot đã làm sạch từ `217,049` bản ghi thô, `1,200` lệnh kiểm thử ngoài mẫu qua 5 phiên test), mô hình đầy đủ (`full`) đạt **MAE tổng thể `1.92 bps`** (so với `2.16 bps` của `ladder_only` và `17.20 bps` của `naive_mid`), giảm sai số **`-1.73 bps`** trên tập lệnh **vượt sổ hiển thị** (`n = 167`, CI95 bootstrap theo cụm phiên `[-2.26, -1.27] bps`), đồng thời công bố minh bạch độ phủ khoảng dự báo 90% ở nhóm vượt sổ là **`89.2%`** (Wilson CI `[83.6%, 93.1%]`).

---

## 2. Bối cảnh và phát biểu bài toán

### 2.1. Vấn đề tài chính có thật tại Việt Nam
Tại HOSE, sổ lệnh công khai cho nhà đầu tư chỉ hiển thị tối đa **3 mức giá mua/bán tốt nhất**. Trong các pha thị trường biến động mạnh (tin vĩ mô, bùng nổ thanh khoản, rút thanh khoản đột ngột cuối phiên chiều), khoảng cách giữa "giá đang nhìn thấy trên bảng" và "VWAP thực tế nhận được khi đi lệnh" tăng phi tuyến trên các cổ phiếu midcap như `PDR`, `DIG`, `NLG`, `HCM` so với nhóm trụ VN30 như `HPG`, `VCB`, `FPT`, `SSI`.

### 2.2. Đối tượng người dùng mục tiêu & quyết định cần hỗ trợ
- **Chuyên viên môi giới / Tư vấn giao dịch tổ chức nhỏ:** Cần giải thích định lượng cho khách hàng *tại sao nên chia nhỏ lệnh 2 tỷ VND làm 4–8 đợt thay vì quét 1 lệnh*, và ước lượng chi phí tất cả trong một (IS + phí + thuế) trước khi bấm nút.
- **Nhà đầu tư chủ động / Chuyên viên phân tích vi cấu trúc:** Cần phát hiện sớm sự cố bốc hơi độ sâu sổ lệnh (`DEPTH_EVAPORATION`), giãn spread bất thường (`SPREAD_WIDEN`), mất cân bằng cung cầu cực đoan (`OBI_EXTREME`), đột biến khối lượng (`TRADE_BURST`), dòng vốn ngoại (`FOREIGN_BURST`), và kiểm chứng xem các tín hiệu đó có thực sự phản ánh rủi ro thanh khoản tương lai hay không.

---

## 3. Thiết kế giải pháp

### 3.1. Nguyên tắc thiết kế (Định hướng giá trị tài chính trước công nghệ)
1. **Không trộn dữ liệu mô phỏng với dữ liệu thật:** Giao diện gắn nhãn nổi bật `DỮ LIỆU MÔ PHỎNG · SYNTHETIC` khi ở chế độ kiểm chứng bộ sinh, và tách riêng đường dẫn `LIVE_SSI` / `LIVE_NEO`.
2. **Tách chế độ trong sổ (`in_book`) và vượt sổ (`beyond_book`):** Không dùng độ chính xác tất định của lệnh nhỏ nằm gọn trong 3 mức giá để thổi phồng hiệu quả mô hình; chỉ đánh giá phần giá trị gia tăng của mô hình thống kê trên nhóm lệnh thực sự vượt độ sâu hiển thị.
3. **Liên thông quyết định theo ngữ cảnh:** Mọi màn hình đều nối với nhau — từ Watchlist tổng quan (xem biến động 1 phút $\sigma$ & badge cảnh báo) → Kiểm tra cấu phần LHS & What-If → Truy nguyên cảnh báo MAD P1/P2/P3 → Nhảy thẳng tới đúng thời điểm snapshot `ts_ms` trong Buồng mô phỏng chi phí thực thi.

### 3.2. Chuỗi giá trị 7 lớp (Data-to-Value Pipeline) & Ma trận 6 bậc Bloom
Hệ thống thiết kế đáp ứng đầy đủ 6 cấp độ thang đo tư duy Bloom:
- **Bậc 1 (Nhớ):** Chuẩn hóa schema dữ liệu HOSE, giữ nguyên RAW bất biến (`JSONL.gz`) + manifest SHA-256 + bảo mật khóa API qua biến môi trường.
- **Bậc 2 (Hiểu):** Tự động diễn giải trạng thái phiên giao dịch bằng văn bản định lượng (*Tóm tắt điều hành phiên*) và trực quan hóa bản đồ cờ chất lượng dữ liệu.
- **Bậc 3 (Áp dụng):** Tính toán 5 cấu phần LHS, biến động 1 phút $\sigma$ (bps), độ sâu 3 mức, cùng bộ lọc tín hiệu đa chiều có điểm căn Mean/Median trực tiếp trên thanh trượt.
- **Bậc 4 (Phân tích):** Phát hiện cảnh báo bất thường theo giờ trong phiên (15 phút/bucket) bằng Robust Z-score (MAD) kèm chứng cứ snapshot trước/trong/sau và cầu nối nhảy tới thời điểm cảnh báo trên sổ lệnh DOM.
- **Bậc 5 (Đánh giá):** Kiểm chứng *walk-forward 5 folds*, *bootstrap theo cụm phiên* (tránh giả độc lập theo lệnh), Wilson CI cho độ phủ khoảng dự báo, kiểm tra hướng giá ngoài mẫu của OBI (5 phân vị), và so sánh phục hồi độ sâu giữa VN30 lớn với Midcap mỏng.
- **Bậc 6 (Sáng tạo):** Cung cấp **Phòng thí nghiệm trọng số LHS (What-If Sandbox)** theo thời gian thực và **Bộ so sánh chiến lược chia nhỏ lệnh (1 / 2 / 4 / 8 đợt)** phục vụ ra quyết định tối ưu thực thi.

---

## 4. Khai thác NEO API & SSI FastConnect dự phòng

### 4.1. Hợp đồng dữ liệu và cơ chế dự phòng hợp lệ
Theo quy định của đề bài cho phép sử dụng **SSI FastConnect API** làm nguồn thay thế khi VPBankS NEO API gặp lỗi kết nối/xác thực, NeoScope triển khai kiến trúc **Dual-Provider Adapter** có cấu hình tường minh trong `config/settings.yaml`:
- **Nguồn chính hiện hành (LIVE):** `SSI FastConnect API v3` (`https://api.ssi.com.vn`, WebSocket `wss://stream.ssi.com.vn/ws/v3`), gồm REST OAuth2 (`api/v3/Market/AccessToken`), danh mục chứng khoán (`api/v3/Market/Securities`), lịch sử OHLC (`api/v3/Market/DailyOHLCHistory`) và các kênh streaming (`ssi_quote`, `ssi_trade`, `ssi_room`, `ssi_market`, `ssi_indexsummary`).
- **Nguồn dự phòng / đối ứng theo đề tài:** `VPBankS NEO API` (`https://external.vpbanks.com.vn/auth/token`, REST `https://neoapi.vpbanks.com.vn/neo-api/`, WebSocket `wss://neoapi.vpbanks.com.vn/stock-stream/broker`), xử lý chuẩn các kênh `stockInfo`, `marketInfo`, `marketVolume`, `marketSession`.

*(Lưu ý thủ tục học vụ: Sinh viên lưu trữ và đính kèm email xác nhận của giảng viên chấp thuận việc chuyển/bổ sung SSI FastConnect API tại Mục Phụ lục trước khi nộp bài chính thức.)*

### 4.2. Chuẩn hóa các "bẫy dữ liệu" thực tế của thị trường Việt Nam
Dựa trên khảo sát payload mẫu của NEO và SSI (`docs/provider_contracts.md`, `docs/ssi_fastconnect.md`), bộ chuẩn hóa xử lý nghiêm ngặt các tình huống thực tế:
- **Đơn vị giá:** Payload SSI trả `bid_prices / ask_prices` ở đơn vị **nghìn VND** trong khi giá khớp ở đơn vị **VND** → chuẩn hóa đồng nhất sang **VND**; giữ nguyên payload gốc ở tầng RAW.
- **Trường rỗng & phiên định kỳ (ATO/ATC):** `totalBidQTTY` / `totalAskQTTY` hoặc giá có thể mang giá trị `null` hoặc chuỗi `'ATO'`/`'ATC'` → **không điền số 0 giả**, lưu `null` và gắn cờ chất lượng tường minh (`NULL_TOTAL_QTY`, `ATO_ATC_PRICE`).
- **Khối lượng lũy kế & đồng hồ:** Tính giao dịch phát sinh bằng *delta đơn điệu* của `totalTradingVolume`; gắn cờ các gói tin đến muộn (`LATE_ARRIVAL`), sai thứ tự (`OUT_OF_ORDER`), trùng lặp (`DUPLICATE_DROPPED`), crossed book hoặc khoảng trống dữ liệu `> 30 giây` (`STALE_GAP`).

---

## 5. Logic tài chính & mô hình định lượng

### 5.1. Chỉ số sức khỏe thanh khoản LHS (Liquidity Health Score, 0–100)
Trên cửa sổ trailing 15 phút (`bars` tần suất 60 giây), mỗi cổ phiếu $i$ được chấm điểm theo 5 cấu phần chuẩn hóa hạng (percentile rank trong tập chuẩn tham chiếu):
1. **Độ chặt (`tightness`):** Nghịch đảo chênh lệch giá chào mua/bán tương đối $\text{spread\_bps} = \frac{\text{ask}_1 - \text{bid}_1}{\text{mid}} \times 10^4$.
2. **Độ sâu (`depth`):** Tổng giá trị niêm yết 3 mức tốt nhất ở hai phía bid/ask.
3. **Tính tức thời (`immediacy`):** Dựa trên chỉ số Amihud Illiquidity $\text{ILLIQ} = \frac{|r_{1\text{m}}|}{\text{Volume\_VND}}$ — đo lường 1 đồng dòng tiền làm giá dịch chuyển bao nhiêu.
4. **Độ ổn định (`stability`):** Nghịch đảo độ biến động của spread trong cửa sổ 15 phút.
5. **Độ cân bằng (`balance`):** Nghịch đảo trị tuyệt đối mất cân bằng sổ lệnh $|\text{OBI}|$, với:
   $$\text{OBI} = \frac{\sum_{k=1}^{3} V^{\text{bid}}_k - \sum_{k=1}^{3} V^{\text{ask}}_k}{\sum_{k=1}^{3} V^{\text{bid}}_k + \sum_{k=1}^{3} V^{\text{ask}}_k} \in [-1, 1]$$

Người dùng có thể tự điều chỉnh trọng số $\{w_1,\dots,w_5\}$ trong **What-If Sandbox** (hoặc chọn preset *Lướt sóng nhanh*, *Đi lệnh lớn Block*, *Phòng thủ ổn định*) và theo dõi ngay lập tức **tương quan thứ hạng Spearman $\rho$** cùng biến động thứ hạng từng mã so với mặc định $1:1$.

### 5.2. Mô hình chi phí thực thi Implementation Shortfall & Chia nhỏ lệnh (1 / 2 / 4 / 8 đợt)
Kế thừa Perold (1988) và Almgren et al. (2005), chi phí thực thi kỳ vọng của một lệnh quy mô $Q$ (cổ phiếu) tại thời điểm đến $t_0$ có giá giữa $P_{\text{mid},0}$ gồm 2 phần:
1. **Chi phí quét sổ tất định (3 mức hiển thị, `ladder_only`):** Khớp trực tiếp vào các mức giá chào trên sổ lệnh hiện hữu cho phần khối lượng nằm trong tổng độ sâu 3 mức (`coverage = \min(1, V_{\text{vis}} / Q)`).
2. **Chi phí phần dư vượt sổ (`beyond_book`):** Với tỷ lệ chưa khớp $u = 1 - \text{coverage} > 0$, thời gian thực thi dự kiến $\tau_s$ (bị chặn bởi chân trời mô phỏng $H = 180\text{s}$ ở tỷ lệ tham gia tối đa $15\%$ khối lượng thị trường) tạo ra:
   - *Thành phần trôi giá có hướng (drift):* $E_{\text{unfilled}} = \text{side} \cdot \kappa_{\text{fold}} \cdot \text{OBI}_0 \cdot \tau_s$
   - *Bất định biến động thời điểm (risk term):* $\sigma_{\text{exec}} = Y_{\text{fold}} \cdot \sigma_{1\text{m}} \cdot \sqrt{\tau_s / 60} \cdot u$ → cho ra khoảng dự báo 90% $[E[\text{IS}] - 1.6449\,\sigma_{\text{exec}}, \; E[\text{IS}] + 1.6449\,\sigma_{\text{exec}}]$.

**Mở rộng hỗ trợ quyết định chia nhỏ lệnh & chi phí Việt Nam:** Hàm `buildOrderSlicingComparison` mô phỏng chia tổng lệnh $Q$ thành $K \in \{1, 2, 4, 8\}$ đợt đều nhau ($q_K = Q/K$), đồng thời cộng chi phí giao dịch cố định theo thực tế thị trường Việt Nam (`fee_rate = 0.15% = 15 bps`, `sell_tax_rate = 0.10% = 10 bps` khi bán → tổng cố định `25 bps` cho lệnh bán, `15 bps` cho lệnh mua). Mô hình công bố rõ giả định: sổ lệnh 3 mức hồi phục đầy đủ giữa các đợt chia (cận dưới lý tưởng nếu không tính phản hồi own-impact).

### 5.3. Phát hiện bất thường theo khung giờ trong phiên (Robust MAD Z-score)
Do thanh khoản nội ngày biến đổi theo đường cong chữ U, các chỉ báo `SPREAD_WIDEN`, `DEPTH_EVAPORATION`, `OBI_EXTREME`, `TRADE_BURST` được chuẩn hóa theo từng **khung 15 phút (`bucket_min = 15`)** trên chuỗi lịch sử trước đó (bỏ phiên khởi động `warmup_sessions = 1`):
$$Z_{\text{MAD}}(x) = \frac{x - \text{median}(x)}{1.4826 \times \text{median}(|x - \text{median}(x)|)}$$
Cảnh báo chỉ kích hoạt khi đồng thời thỏa: **$|Z_{\text{MAD}}| \ge 3.0$**, **vượt phân vị 99%**, và **duy trì bền vững ít nhất 3 tick liên tiếp (`persistence_n = 3`)** với thời gian nghỉ `cooldown_s = 60s`. Riêng `FOREIGN_BURST` áp dụng thêm cổng đuôi $|net| \ge 2 \times p_{99}$ trên các bản ghi có giao dịch ngoại khác 0.

---

## 6. Kiến trúc hệ thống & quy trình xử lý

Hệ thống NeoScope hoạt động theo mô hình Full-Stack tách biệt rõ tầng xử lý dữ liệu nghiên cứu, máy chủ API trung gian (proxy bảo mật) và giao diện phân tích tương tác:

1. **Tầng Thu thập & Lưu trữ Bất biến (`/neoscope/src`):**
   - `capture` đọc WebSocket/REST qua bộ điều tiết `TokenBucket (5 req/s)`, ghi nối tiếp nguyên bản vào `data/raw/<SESSION>/*.jsonl.gz`, đóng phiên sinh `manifest.json` chứa mã băm SHA-256 từng file và `config_hash`.
   - `process` chuẩn hóa, khử trùng lặp theo cửa sổ 5 bản ghi, gắn cờ chất lượng, resample thành `snapshots.parquet` (5s) và `bars.parquet` (1m). Có thể tái lập hoàn toàn bằng `neoscope process --force`.
   - `validate` chạy đánh giá ngoài mẫu walk-forward 5 folds và xuất `data/results/summary.json` cùng các bảng kiểm chứng.
2. **Tầng Máy chủ Node.js/Express (`/server.ts` & `/server/*`):**
   - Nạp dữ liệu Curated & Parquet (qua `hyparquet`) và dữ liệu JSON kết quả; phục vụ REST endpoints (`/api/bootstrap`, `/api/session/:date`, `/api/execution/estimate`, `/api/execution/simulate`, `/api/validation/extra`, `/api/provider/status`, `/api/provider/probe`).
   - Thực thi mọi tính toán nhạy cảm và kiểm tra kết nối API trực tiếp phía server; **không bao giờ đẩy bí mật API xuống trình duyệt**.
3. **Tầng Giao diện Phân tích React + TypeScript + Plotly (`/src/pages/*`):**
   - 7 màn hình chuyên biệt: *Tổng quan*, *Thanh khoản (cấu phần & What-If Sandbox)*, *Mô phỏng chi phí (DOM + Cost Curve + Slicing 1/2/4/8)*, *Cảnh báo (kèm cầu nối sang Thực thi)*, *Kiểm chứng ngoài mẫu*, *Dữ liệu & Chất lượng (Live Probe + Manifest + Heatmap)*, và *Phương pháp & Giới hạn (Sơ đồ 7 lớp + Ma trận Bloom)*.

---

## 7. Bảo mật, quản lý khóa & tuân thủ API có trách nhiệm

1. **Quản lý khóa hoàn toàn qua biến môi trường (`.env`, không commit secret):** Toàn bộ thông tin nhạy cảm (`SSI_CLIENT_ID`, `SSI_API_KEY`, `SSI_API_SECRET`, `NEO_USERNAME`, `NEO_PASSWORD`) chỉ tồn tại trong bộ nhớ tiến trình backend (`process.env`). File `.env.example` chỉ lưu tên biến mẫu.
2. **Giao diện không nhập và không trả về khóa thô:** Endpoint `GET /api/provider/status` chỉ trả về cờ boolean (`hasSsiClientId`, `hasSsiApiKey`, `hasSsiSecret`, `neoBackupReady`), tên endpoint công khai và giới hạn tốc độ. `POST /api/provider/probe` trả về mã trạng thái HTTP, độ trễ (ms), bước kiểm tra và thông báo chẩn đoán an toàn (nếu thiếu biến môi trường hoặc lỗi HTTP 401/429 sẽ báo rõ nguyên nhân mà không rò rỉ payload token).
3. **Tuân thủ giới hạn tần suất (Responsible Rate Limiting):** Toàn bộ request tới SSI/NEO đi qua hàng đợi TokenBucket cấu hình mặc định **`5 req/s`**, timeout `20s`, tối đa `3` lần thử lại có backoff lũy tiến (`1.0s`), và bộ đệm nhập hữu hạn `10,000` thông điệp (nếu quá tải sẽ dừng an toàn thay vì âm thầm làm rơi dữ liệu gây sai lệch).
4. **Phạm vi chỉ đọc (Read-only Market Data):** Không gọi bất kỳ endpoint đặt lệnh thật nào; mọi thao tác khớp lệnh trong NeoScope là mô phỏng trên dữ liệu lịch sử hoặc sổ lệnh chụp lại.

---

## 8. Kết quả thực nghiệm & kiểm chứng

Các số liệu dưới đây được trích xuất trực tiếp từ `data/results/summary.json` (tập kiểm chứng chuẩn với `seed = 20261117`, `config_hash = 04c3812c60446fad`):

### 8.1. Quy mô làm sạch & truy vết dữ liệu
- **Số phiên giao dịch:** `10` phiên (`2026-11-03` đến `2026-11-16`), chia thành `5` phiên tích lũy khởi tạo và `5` phiên kiểm thử ngoài mẫu (`2026-11-10` đến `2026-11-16`).
- **Danh mục đối chứng 8 mã:** Nhóm VN30 thanh khoản lớn (`HPG`, `VCB`, `FPT`, `SSI`) và nhóm Midcap mỏng (`PDR`, `DIG`, `NLG`, `HCM`).
- **Chất lượng dữ liệu qua pipeline:** Tổng cộng **`217,049`** bản ghi RAW → **`216,165`** bản ghi Curated sạch (đã nhận diện và loại bỏ chính xác **`884`** bản ghi trùng lặp).

### 8.2. Kết quả kiểm chứng mô hình Implementation Shortfall ngoài mẫu (`n = 1,200` lệnh test)
| Mô hình | Tập đánh giá | Số lệnh (n) | MAE (bps) | RMSE (bps) | Bias (bps) |
|---|---|---:|---:|---:|---:|
| **Mô hình đầy đủ (`full`)** | Toàn bộ (`ALL`) | 1,200 | **1.92** | **7.33** | **+0.03** |
| Quét sổ tất định (`ladder_only`) | Toàn bộ (`ALL`) | 1,200 | 2.16 | 8.23 | +1.17 |
| Giá giữa ngây thơ (`naive_mid`) | Toàn bộ (`ALL`) | 1,200 | 17.20 | 21.03 | -16.64 |
| **Mô hình đầy đủ (`full`)** | **Vượt sổ (`beyond_book`)** | 167 | **13.78** | **19.66** | **+0.25** |
| Quét sổ tất định (`ladder_only`) | Vượt sổ (`beyond_book`) | 167 | 15.54 | 22.05 | +8.42 |
| Giá giữa ngây thơ (`naive_mid`) | Vượt sổ (`beyond_book`) | 167 | 27.22 | 31.51 | -23.19 |
| Tất cả (`full` / `ladder_only`) | Trong sổ (`in_book`) | 1,033 | 0.00 | 0.00 | 0.00 |

- **Kiểm định Bootstrap theo cụm phiên (`5` cụm test, `2,000` lần lặp):**
  - Chênh lệch $\Delta\text{MAE}(\text{full} - \text{ladder\_only})$ trên nhóm **vượt sổ (`beyond_book`)** đạt **`-1.73 bps`**, khoảng tin cậy 95% **`[-2.26, -1.27] bps`**, $p = 0.0625$ (âm đều qua cả 5 phiên test: từ `-0.91 bps` đến `-2.54 bps`).
  - So với `naive_mid` trên toàn bộ mẫu, $\Delta\text{MAE} = \mathbf{-15.28\text{ bps}}$ (`CI95 [-15.52, -15.04] bps`).
- **Độ phủ khoảng dự báo 90% (Prediction Interval Coverage):**
  - Nhóm **vượt sổ (`beyond_book`, n = 167):** Đạt **`89.2%`** (149/167 lệnh nằm trong khoảng dự báo, Wilson CI95 **`[83.6%, 93.1%]`**), bề rộng trung bình `65.83 bps` — bám sát mục tiêu danh nghĩa 90%.
  - Toàn bộ mẫu (`ALL`, n = 1,200) đạt `98.5%` do `1,033` lệnh trong sổ có PI suy biến bề rộng `0.00 bps` (được báo cáo tách bạch để không phóng đại thành tích).

### 8.3. Giá trị xây dựng chỉ số LHS, sức dự báo OBI & Độ nhạy trọng số
- **Tương quan LHS với thanh khoản kém tương lai (Forward ILLIQ 15 phút):** Spearman trung bình trên 5 phiên test đạt **`-0.789`** (từ `-0.758` đến `-0.815`), chứng minh điểm LHS cao phản ánh thanh khoản thực sự thông suốt hơn ở 15 phút kế tiếp.
- **Độ ổn định khi xáo trộn trọng số LHS:** Biến thiên tương quan Spearman thứ hạng luôn giữ ở mức **`0.956 – 0.974`** trên cả 5 chiều trọng số (nhỏ nhất ở `balance` với mean `0.956`), cho thấy cấu trúc LHS không bị chi phối bởi một tiêu chí đơn lẻ.
- **Sức dự báo hướng giá ngắn hạn của OBI (`n = 1,784` mỗi ngũ phân vị):** Đơn điệu tăng hoàn toàn từ ngũ phân vị 1 ($\overline{\text{OBI}} = -0.334$, lợi nhuận 1 phút kế tiếp **`-2.35 bps`**, $P(\text{tăng}) = 35.5\%$) lên ngũ phân vị 5 ($\overline{\text{OBI}} = +0.339$, **`+2.64 bps`**, $P(\text{tăng}) = 44.6\%$), tái lập đúng kết quả kinh điển của Cont, Kukanov & Stoikov (2014).

### 8.4. Hiệu năng cảnh báo bất thường & Phục hồi thanh khoản sau cú sốc
- **Precision / Recall từng loại cảnh báo (đối chiếu ground-truth events):**
  - `DEPTH_EVAPORATION`: `90` cảnh báo, Precision **`97.8%`**, Recall **`80.0%`** (`16/20` sự kiện).
  - `TRADE_BURST`: `44` cảnh báo, Precision **`100.0%`**, Recall **`60.0%`** (`18/30` sự kiện).
  - `SPREAD_WIDEN`: `87` cảnh báo, Precision **`95.4%`**, Recall **`53.3%`** (`16/30` sự kiện).
  - `OBI_EXTREME`: `35` cảnh báo, Precision **`57.1%`**, Recall **`70.0%`** (`14/20` sự kiện).
  - `FOREIGN_BURST`: `36` cảnh báo, Precision **`50.0%`**, Recall **`90.0%`** (`18/20` sự kiện) — phản ánh thực tế tỷ lệ báo động giả cao hơn khi biên độ ngoại giao dịch thưa thớt nhưng có ngưỡng đuôi rộng để không bỏ sót dòng tiền ngoại lớn.
- **Khả năng phục hồi độ sâu sau cú sốc khối lượng:** Nhóm **VN30 lớn** (`4,540` episodes: median `5.0s`, p90 `10.0s`, tỷ lệ chưa phục hồi **`0.44%`**) phục hồi bền vững hơn nhóm **Midcap mỏng** (`4,283` episodes: median `5.0s`, p90 `10.0s`, tỷ lệ chưa phục hồi **`0.51%`**).

### 8.5. Kiểm thử phần mềm tự động
- **Bộ unit test TypeScript (`node --test` qua `tsx --test`):** `29/29` test vượt qua hoàn toàn ở lần chạy gần nhất (bao gồm kiểm tra công thức trọng số LHS & Spearman $\rho$, lọc tín hiệu Vol/LHS, sắp xếp watchlist theo $\sigma$ 1 phút, logic tính giá trị quét sổ và mô hình chia nhỏ lệnh `buildOrderSlicingComparison`).

---

## 9. Hạn chế và rủi ro (Công bố trung thực)

1. **Dữ liệu mặc định là SYNTHETIC:** Mọi chỉ số kiểm chứng ở Mục 8 được đo trên bộ sinh có seed mô phỏng cơ chế vi cấu trúc thị trường Việt Nam. Chúng xác nhận tính đúng đắn của thuật toán, *không* khẳng định mức sinh lời hay chi phí trượt giá chính xác trên phiên giao dịch HOSE thật.
2. **Giả định sổ lệnh hồi phục khi chia nhỏ lệnh & không có own-impact:** Ở chế độ so sánh chia 1/2/4/8 đợt và bài kiểm chứng `in_book`, hệ thống giả định ta tiếp cận được toàn bộ khối lượng hiển thị ở 3 mức (chưa mô phỏng vị trí xếp hàng — queue position) và hành động ăn lệnh đợt trước không làm nhà tạo lập rút thanh khoản ở đợt sau (own-impact). Do đó với lệnh quy mô rất lớn (tỷ VND trên midcap mỏng), kết quả mô phỏng phải được đọc như **cận dưới của chi phí thực**.
3. **Số cụm phiên kiểm thử còn hạn chế ($n_{\text{test}} = 5$):** Dù có `1,200` lệnh, bootstrap theo cụm phiên chỉ có $2^5 = 32$ hoán vị dấu khiến $p$-value tối thiểu hai phía bằng $1/16 = 0.0625$ và khoảng tin cậy rộng hơn kiểm thử ngây thơ theo từng lệnh — đây là lựa chọn khoa học có chủ đích để tránh tự lừa dối thống kê.
4. **Miễn trừ trách nhiệm:** NeoScope là công cụ nghiên cứu học thuật và hỗ trợ phân tích chi phí thực thi, **không** cấu thành khuyến nghị mua/bán cổ phiếu hay cam kết khớp lệnh thực tế.

---

## 10. Kết luận & hướng phát triển

NeoScope chứng minh rằng việc khai thác dữ liệu vi cấu trúc cấp độ sổ lệnh từ **SSI FastConnect API v3 / VPBankS NEO API** có thể đi xa hơn rất nhiều so với bảng giá truyền thống: chuyển hóa trực tiếp các thông điệp quote/trade thành thước đo sức khỏe thanh khoản có trọng số tùy biến, cảnh báo bất thường thích ứng theo khung giờ nội ngày, ước tính chi phí trượt giá Implementation Shortfall được kiểm chứng ngoài mẫu, và gợi ý chia nhỏ lệnh kèm đầy đủ phí/thuế Việt Nam.

**Hướng phát triển tiếp theo:**
- Thu thập và lưu trữ chuỗi phiên `LIVE` liên tục tối thiểu 20–30 ngày giao dịch HOSE thực để hiệu chỉnh lại bộ tham số $(\kappa, Y)$ ngoài môi trường synthetic.
- Bổ sung mô hình ước lượng vị trí hàng đợi (Queue Position Estimation) và cơ chế suy giảm thanh khoản có phản hồi (*propagator impact model*) cho bài toán chia nhỏ lệnh TWAP/VWAP nhiều kỳ.
- Mở rộng phân tích liên sàn (HOSE + HNX + Phái sinh VN30F1M) để phát hiện sớm hiện tượng lệch basis và dẫn dắt dòng tiền chỉ số.

---

## Phụ lục: Checklist minh chứng & hướng dẫn tái lập (Reproducibility)

### A. Checklist đối chiếu yêu cầu đề tài (100/100 Readiness)
- [x] **Vấn đề thực tế rõ ràng:** Ảo giác thanh khoản lệnh lớn & nhiễu cảnh báo theo giờ trên sàn HOSE.
- [x] **API nguồn là cốt lõi + Bảo mật nghiêm ngặt:** Adapter cho SSI FastConnect API v3 & VPBankS NEO API, TokenBucket `5 req/s`, secrets chỉ nằm trong `.env` phía server, có **Live Probe** chẩn đoán trực quan trên web UI.
- [x] **Lớp logic tài chính định lượng:** LHS 5 cấu phần, What-If Sandbox (Spearman $\rho$), Robust MAD Z-score (15m bucket), Implementation Shortfall 3 mức + $\sqrt{\tau}$, Slicing 1/2/4/8 đợt + phí 0.15% + thuế 0.1%.
- [x] **Sản phẩm web hoàn chỉnh tương tác:** 7 trang chức năng + bộ lọc tín hiệu sidebar + tóm tắt phiên tự động + cầu nối Cảnh báo → Mô phỏng chi phí.
- [x] **Bằng chứng kiểm chứng & Minh bạch giới hạn:** Walk-forward 5 folds, Bootstrap cụm phiên, Wilson CI95, kiểm tra OBI 5 ngũ phân vị, bảng phục hồi VN30 vs Midcap, và mục giới hạn trung thực trên cả giao diện lẫn báo cáo.

### B. Hướng dẫn khởi chạy & tái lập cho giảng viên / hội đồng chấm
1. **Chạy giao diện web Full-Stack:**
   ```bash
   npm install
   npm run dev
   ```
   Mở `http://localhost:3000` (mặc định tự nạp 10 phiên Curated + kết quả kiểm chứng ngoài mẫu).
2. **Chạy kiểm thử đơn vị (Unit Tests):**
   ```bash
   npx tsx --test server/*.test.ts src/server/analytics.test.ts src/lib/tradingview.test.ts src/lib/symbolFilter.test.ts
   ```
3. **Tái lập toàn bộ pipeline từ RAW (Python CLI):**
   ```bash
   neoscope process --force
   neoscope validate
   ```
4. **Kiểm tra cấu hình kết nối thực tế (Live Probe không làm lộ key):**
   - Khai báo `SSI_CLIENT_ID`, `SSI_API_KEY`, `SSI_API_SECRET` (hoặc `NEO_USERNAME`, `NEO_PASSWORD`) trong `.env` server-side.
   - Mở tab **Dữ liệu & chất lượng** trên web → nhấn **Chạy kiểm tra kết nối (API Probe)** để xác nhận quá trình lấy token / bắt tay REST với giới hạn 5 req/s.
5. **Lưu ý hồ sơ nộp bài cuối kỳ (Sinh viên bổ sung khi xuất PDF):**
   - Đính kèm **email chấp thuận của giảng viên** cho phép sử dụng nguồn dữ liệu thay thế **SSI FastConnect API** theo điều khoản đề bài.
   - Đính kèm **video demo 2–3 phút** quay lại thao tác thực tế qua 7 tab (đặc biệt luồng What-If Sandbox, Cầu nối Cảnh báo → Mô phỏng chia nhỏ lệnh, và Live API Probe nếu quay ở chế độ có key thật).
