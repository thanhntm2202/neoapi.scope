# NeoScope — hồ sơ sản phẩm và thiết kế đã triển khai

> **Trạng thái:** hồ sơ này mô tả hệ thống trong mã nguồn hiện tại; các mục “hướng phát triển” chưa được coi là tính năng đã hoàn thành. Nguồn live mặc định là SSI FastConnect API v3. NEO API của VPBankS được giữ làm nguồn dự phòng có chọn chủ động.

## 1. Tóm tắt điều hành

NeoScope là công cụ nghiên cứu vi cấu trúc thị trường và hỗ trợ ra quyết định về thanh khoản cho cổ phiếu Việt Nam. Từ dữ liệu giá khớp, sổ lệnh hiển thị và trạng thái chỉ số, hệ thống tạo ra chỉ báo thanh khoản tương đối (LHS), cảnh báo bất thường, ước tính implementation shortfall (IS) giả định và kết quả đánh giá theo thời gian. Sản phẩm không khuyến nghị mua/bán và không gửi lệnh thật.

Bài toán người dùng: bảng giá cho biết giá và khối lượng, nhưng khó cho biết một lệnh giả định có lớn so với sổ hiển thị hay không, chi phí tác động có thể ở mức nào, và độ tin cậy của ước tính ra sao. NeoScope kết nối quan sát thị trường với phép đo, mô phỏng có giả định công khai, và kiểm chứng ngoài mẫu.

### Điều chỉnh nguồn dữ liệu so với đề gốc

Đề học phần nêu NEO API là nguồn hoặc hạ tầng cốt lõi mặc định và ghi rõ SSI có thể thay thế hoàn toàn khi NEO API gặp lỗi; giảng viên đã xác nhận cách áp dụng này cho đồ án. Vì vậy NeoScope dùng SSI v3 làm nguồn live mặc định/thay thế được phê duyệt, còn NEO vẫn là adapter tùy chọn. Hai nguồn được thu và phân tích theo namespace riêng; phê duyệt thay thế không đồng nghĩa với việc trộn dữ liệu của hai nhà cung cấp. Khi nộp, đính kèm xác nhận của giảng viên để người chấm áp dụng đúng phương án khi đối chiếu rubric. Xem [đề học phần](de-bai/De-thi-cuoi-ky-NEO-API.docx), [README](../README.md), và [hợp đồng nguồn dữ liệu](provider_contracts.md).

## 2. Người dùng và phạm vi quyết định

| Người dùng | Câu hỏi NeoScope hỗ trợ |
|---|---|
| Nhà đầu tư hoặc môi giới cần trao đổi về thanh khoản | Sổ lệnh hiển thị có đáp ứng được quy mô lệnh giả định đến đâu? |
| Chuyên viên phân tích | Spread, độ sâu và mất cân bằng thay đổi thế nào theo mã và khung giờ? |
| Nhà nghiên cứu / sinh viên | Kết quả có tái lập được, không nhìn trước và có giới hạn rõ không? |

Hệ thống hỗ trợ phân tích thị trường, không xử lý danh mục khách hàng, không đánh giá mức độ phù hợp sản phẩm đầu tư, không gửi lệnh và không đảm bảo khả năng khớp.

### Phạm vi sản phẩm: kết hợp gợi ý #3, #4, #6 và #7

NeoScope kết hợp bốn gợi ý thành một quy trình phân tích thống nhất thay vì bốn màn hình không liên quan: đo sức khỏe thanh khoản → quan sát mất cân bằng sổ lệnh → phát hiện quan sát bất thường → xem cảnh báo và bằng chứng.

| Gợi ý trong đề | Năng lực sản phẩm | Đầu ra có thể quan sát |
|---|---|---|
| **#3 · Bộ đo thanh khoản cổ phiếu** | Spread, depth, ILLIQ, ổn định spread, OBI và khả năng hấp thụ lệnh; tổng hợp thành LHS tương đối. | Xếp hạng watchlist, điểm cấu phần và tỷ lệ quy mô lệnh được phủ bởi sổ hiển thị. |
| **#4 · Theo dõi mất cân bằng sổ lệnh** | Tính OBI từ ba mức hai phía, theo dõi trên thời gian và dùng biến cân bằng trong LHS/ước tính impact. | OBI theo mã, thành phần LHS và phân tích hướng lợi nhuận kế tiếp ngoài mẫu. |
| **#6 · Phát hiện bất thường thị trường** | Baseline expanding theo mã và bucket 15 phút; screening spread, depth, OBI, volume và flow khi semantics nguồn được xác nhận. | Sự kiện vượt cổng thống kê với giá trị, baseline, z-score, percentile và số quan sát huấn luyện. |
| **#7 · Hệ thống cảnh báo thông minh** | Lọc sự kiện theo phiên/mã/loại, xếp ưu tiên P1/P2/P3 theo độ hiếm lịch sử và mở biểu đồ truy nguyên. | Danh sách cảnh báo có mức ưu tiên và giải thích. P1/P2/P3 biểu thị độ hiếm, không phải xác suất tổn thất hay mức thiệt hại. |

Các mức ưu tiên được xếp từ percentile đuôi lịch sử (99%, 99,5%, 99,9%) sau khi sự kiện vượt ngưỡng loại tương ứng. Cảnh báo hiện được tạo khi chạy bước `analyze`; ứng dụng hiển thị trạng thái kết nối và có thao tác tải lại dữ liệu. Đây chưa phải dịch vụ push notification thời gian thực.

## 3. Năng lực theo Bloom và đối chiếu rubric

| Bậc Bloom | Bằng chứng có thể quan sát trong sản phẩm |
|---|---|
| Nhớ | Modal Từ điển Vi cấu trúc (`GlossaryModal`, phím tắt `?`) + Từ điển dữ liệu SSI/NEO/synthetic (tên trường, đơn vị, quy ước bps, dữ liệu thiếu). |
| Hiểu | Hướng dẫn quy trình 3 bước, tài liệu phương pháp, và biểu đồ **Hồ sơ thanh khoản chữ U theo khung 15 phút** (so sánh Quoted Spread vs Effective Spread, độ sâu và tỷ trọng KL). |
| Vận dụng | Ghi dữ liệu, replay RAW→curated, **Dual API Probe (SSI + NEO)**, **SSI REST Context (`Securities` + `DailyOHLCHistory`)**, và buồng thử khớp lệnh giấy. |
| Phân tích | Phân rã 5 cấu phần LHS, **Liquidity Beta Commonality** (Chordia et al. 2000), **Portfolio Liquidity & Exit Stress Check**, đối chứng trực tiếp 2 mã, và **Failure Case Explorer** Top 10 ca sai số OOS. |
| Đánh giá | Walk-forward 5 folds, cluster bootstrap, **Đường cong hiệu chỉnh đa mức tin cậy (50/80/90/95%)**, **Chaos Fault Injection Lab** (429 / Stale Gap >30s / 6 bẫy dữ liệu / thiếu fold_params), và **System Self-Check** kiểm toán bảo mật. |
| Sáng tạo | **Execution Playbook Synthesizer** (xuất kịch bản `.md` & bảng chia đợt `.csv`) và **Alert Rule & Threshold Lab** (quét `z`/percentile/dai dẳng/cooldown + xuất giao thức `.json`). |

Liên hệ rubric học phần: vấn đề và người dùng được nêu tại §1–2; kỹ thuật dữ liệu tại §4–5; phương pháp và giả định tại §6; trải nghiệm tại giao diện web React + Express (cùng bản Streamlit gốc); kiểm chứng tại §7; tài liệu và quy trình chạy tại `README.md` cùng các tài liệu trong `docs/`. Phần nguồn dữ liệu phải được giải thích cùng bằng chứng giảng viên duyệt vì dùng SSI thay thế cho NEO-core mặc định theo quy chế đề bài.

### Đối chiếu 7 tiêu chí chấm điểm

| Tiêu chí | Điểm tối đa | Bằng chứng trong sản phẩm | Bằng chứng cần đưa vào bài nộp / bảo vệ |
|---|---:|---|---|
| Vấn đề và giá trị FinTech | 15 | Nhu cầu 3 nhóm người dùng, quy trình 3 bước, Portfolio Stress Check & Execution Playbook giải quyết trực tiếp bài toán thoát lệnh tại VN. | Trình diễn tình huống hoàn chỉnh; sử dụng *User Testing Protocol* có sẵn khi thu thập phản hồi thật (không tự bịa số liệu khảo sát). |
| Nguồn API và kỹ thuật dữ liệu | 20 | SSI FastConnect v3 (WebSocket + REST `Securities`/`DailyOHLCHistory` + TokenBucket 5 RPS), VPBankS NEO adapter & Dual Probe, RAW append-only, cờ chất lượng, SHA-256 manifest. | Minh chứng duyệt SSI thay NEO; ảnh chụp probe/REST context hoặc manifest capture live khi được cấp quyền; không công bố credentials. |
| Phương pháp tài chính và phân tích | 20 | LHS 5 cấu phần, Intraday U-Shape, Liquidity Beta, anomaly screening, IS simulator + slicing 1/2/4/8 đợt, giả định & giới hạn công khai. | Báo cáo đầy đủ kết quả, benchmark, Calibration Curve, Failure Cases và sensitivity; tách bạch synthetic với live. |
| Triển khai kỹ thuật | 20 | Song song Python pipeline (`src/neoscope/`) + Web Terminal Node.js/Express + React/TypeScript (`server.ts`, `server/`, `src/`); secrets strictly server-side; 173 Python pytest + 30 TypeScript unit test. | Ảnh chạy test (`pytest` & `npm test`), System Self-Check `PASS`, mã nguồn & hướng dẫn chạy sạch. |
| Sản phẩm và trải nghiệm | 10 | Giao diện dark fintech 7 trang chuẩn TradingView, phím tắt `/` & `?` (Từ điển & Quy trình), Replay thanh trượt, Stress Danh mục, Chaos Banner và xử lý lỗi an toàn. | Ảnh chụp/video 1440×900 đầy đủ trạng thái bình thường, mô phỏng lỗi Chaos Lab và thiếu dữ liệu/khóa. |
| Kiểm thử và kiểm chứng | 10 | Walk-forward 5 fold, bootstrap cụm phiên, Wilson CI 50–95%, Failure Case Explorer, Chaos Lab, Bảng đối chiếu Synthetic vs Live readiness. | Đính kèm kết quả chạy `npm test` + `pytest`, tệp `neoscope_oos_report.csv` và `neoscope_alert_protocol.json`. |
| Tài liệu và trình bày | 5 | `README.md`, hồ sơ sản phẩm, kiến trúc, phương pháp, mapping API, ngưỡng, giới hạn, báo cáo cuối kỳ + Protocol kiểm thử người dùng. | Hoàn thiện báo cáo, thông tin sinh viên, ảnh/video bảo vệ và trích dẫn học thuật chuẩn mực. |

Không suy ra điểm tuyệt đối chỉ từ việc có nhiều chức năng hoặc test pass. Phần chấm phụ thuộc chất lượng bằng chứng thực tế (bao gồm phiên LIVE tự capture) và trình bày trung thực giới hạn mô hình.

## 4. Kiến trúc hiện tại

```text
SSI FastConnect v3 (mặc định) ─┐
NEO API (backup chọn chủ động) ─┼─> recorder -> RAW có manifest và SHA-256
Synthetic xác định theo seed ──┘                  -> normalize + quality flags
                                                  -> curated Parquet (SYNTHETIC / LIVE_SSI / LIVE_NEO)
                                                  -> Python analytics & validation / Node.js Express API (:3000)
                                                  -> React + TypeScript + Plotly Research Terminal
```

- **SSI:** SDK Python cho luồng WebSocket + client REST TypeScript & Python cho `Securities`, `DailyOHLCHistory`, `AccessToken` dưới TokenBucket 5 req/s.
- **NEO:** REST/WebSocket adapter & probe xác thực JWT server-side (`POST /auth/token`), giữ làm nguồn dự phòng tách biệt namespace.
- **Synthetic:** bộ dữ liệu mô phỏng có seed cố định (`SYNTHETIC`), dùng kiểm chứng cơ chế, tuyệt đối không gán nhãn thị trường thật.
- **Lưu trữ & Giao diện:** curated tách theo `dataset_mode`; paper simulator & execution playbook tách ly hoàn toàn khỏi client giao dịch (0 endpoint đặt lệnh thật).
- **Bảo mật:** toàn bộ `SSI_*` và `NEO_*` chỉ đọc từ `process.env` trên server; `SystemSelfCheck` quét tĩnh xác nhận không lộ secret ra browser.

Chi tiết thành phần ở [architecture.md](architecture.md). Khóa và bí mật chỉ đọc từ biến môi trường; không lưu trong YAML, manifest hoặc log.

## 5. Dữ liệu và quy tắc chuẩn hóa

SSI là nguồn chính, sử dụng các topic trade, quote, room, market và indexsummary theo quyền API được cấp. Quote book và market-band của SSI được đổi từ thang nghìn VND theo ví dụ chính thức sang VND canonical; giá trade SSI đã ở VND. Message SSI đã được SDK giải mã được giữ theo cấu trúc provider để kiểm tra phép chuyển đổi; đây không phải byte-level wire capture. NEO có channel/schema riêng. Không đồng nhất hai nhà cung cấp chỉ vì tên trường canonical giống nhau.

Quy tắc chất lượng gồm parse phòng thủ, giữ null thay vì điền 0, khử lặp payload, phát hiện sai thứ tự/đến muộn, khoảng trống dữ liệu, reset bộ đếm, sổ bắt chéo, giá ngoài biên và mức sổ thiếu. Deltas chỉ được tính từ bộ đếm lũy kế khi semantics phù hợp. SSI foreign buy/sell giữ trong RAW vì cách diễn giải bộ đếm chưa được xác nhận; do đó không dùng để dựng flow analytics. Trường tổng khối lượng cung/cầu SSI không tương đương với tổng độ sâu ba mức và được giữ null.

Schema, đơn vị, thiếu hụt và cautions của SSI được ghi ở [ssi_fastconnect.md](ssi_fastconnect.md); các giới hạn tổng thể ở [limitations.md](limitations.md). Không ghép phiên SSI và NEO thành một chuỗi liên tục nếu chưa có nghiên cứu reconciliation riêng.

## 6. Logic tài chính và đầu ra

### 6.1 Chỉ báo vi cấu trúc

- Quoted spread: (10^4(a-b)/m), với (m=(a+b)/2).
- Depth tiền theo phía: tổng (p_iq_i) trên tối đa ba mức hợp lệ.
- OBI: chênh lệch khối lượng hiển thị hai phía chia tổng khối lượng hiển thị; không phải toàn bộ sổ lệnh thị trường.
- Microprice, HHI độ sâu, độ dốc sổ, biến động thực hiện và biến thể Amihud nội ngày được xây từ dữ liệu có sẵn.
- Resilience đo thời gian depth phía bid quay về ít nhất 80% mức trước một nhịp volume cao; đây là đặc tả của dự án, không phải thước đo chuẩn hóa toàn ngành.

### 6.2 Liquidity Health Score

LHS là điểm tổng hợp tương đối trên năm cấu phần: spread thấp, depth cao, ILLIQ thấp, biến động spread thấp, và |OBI| thấp. Mỗi cấu phần được chuyển thành percentile rank chéo mã tại từng thời điểm; các rank được lấy trung bình có trọng số rồi nhân 100. Mặc định trọng số bằng nhau. Điểm LHS 80 không có nghĩa là mã khỏe hơn 80% watchlist; đó là composite score trên các rank cấu phần. Phân tích độ nhạy nhân đôi lần lượt trọng số, nhưng không thay thế kiểm định giá trị xây dựng ngoài mẫu.

### 6.3 Cảnh báo bất thường

Baseline expanding theo symbol và bucket 15 phút, chỉ lấy các phiên trước. Cấu hình hiện hành dùng warm-up 1 phiên, tối thiểu 30 quan sát baseline, z-score 3 cùng percentile 99% cho đa số loại, dai dẳng 3 quan sát và cooldown 60 giây; OBI và ngoại flow dùng gate riêng phù hợp hơn với biến bị chặn/zero-inflated. Các giá trị là screening defaults có thể cấu hình, không phải chuẩn ngành. Chi tiết tại [thresholds.md](thresholds.md).

### 6.4 Ước tính chi phí và paper simulator

Ước tính IS tách chi phí quét sổ hiển thị, phần dư tham gia theo volume profile, drift liên hệ OBI và timing-risk interval. Các tham số volume, drift và risk được hiệu chỉnh trên các phiên huấn luyện. Ba comparator là `naive_mid`, `ladder_only`, `full`.

Paper simulator giả định có thể tiếp cận toàn bộ lượng hiển thị trong ba mức; phần dư lấy tỷ lệ volume quan sát ở giá best hiện hành, phần chưa khớp đánh dấu theo mid cuối horizon. Nó không mô phỏng queue position, hidden liquidity, phản hồi own-impact, latency hay đầy đủ quy tắc sàn. IS mô hình là trước phí/thuế; phí và thuế được hiển thị riêng theo cấu hình. Đây là mô phỏng nghiên cứu, không phải báo giá thực thi.

## 7. Giao thức kiểm chứng và khả năng tái lập

1. Chọn đúng một namespace dữ liệu và kiểm tra manifest/coverage/quality trước phân tích.
2. Rebuild curated từ RAW bằng `neoscope process --force`.
3. Chạy phân tích và validation trên các phiên theo thứ tự thời gian.
4. Fold test chỉ dùng tham số fit trên các phiên trước ngày test; không shuffle theo snapshot/lệnh.
5. Báo cáo MAE, RMSE, bias, interval coverage, các benchmark và phân tầng theo coverage sổ.
6. Bootstrap theo cụm phiên, không theo lệnh độc lập; báo cáo số cụm để thể hiện power thấp khi lịch sử ngắn.
7. LHS/OBI được coi là kiểm định association/predictive association, không phải quan hệ nhân quả. Precision/recall alert ground-truth chỉ áp dụng với sự kiện được cài trong synthetic.

Quy trình và trường bắt buộc báo cáo nằm tại [validation_protocol.md](validation_protocol.md). Mọi báo cáo nên ghi code revision, config hash, seed, manifest hashes, ngày/nguồn dữ liệu và dependency versions. Không trình bày một kết quả synthetic như kết quả live.

## 8. Hướng dẫn chạy demo

Chạy synthetic để xem sản phẩm trước khi có quyền API:

```powershell
pip install -e .
neoscope all
neoscope app
```

Để ghi SSI live, tạo `.env` từ `.env.example`, đặt thông tin API được cấp, chuyển `NEOSCOPE_MODE=LIVE`, để `NEOSCOPE_PROVIDER=SSI`, rồi chạy:

```powershell
neoscope record
neoscope process
neoscope analyze
neoscope validate
neoscope app
```

Để chuyển qua NEO, dừng recorder, đổi `NEOSCOPE_PROVIDER=NEO`, xác nhận credentials/entitlement, rồi khởi động lại. Dùng cùng namespace khi process/analyze/validate. Dashboard CLI mặc định bind localhost; triển khai từ xa phải được rà soát xác thực, TLS, network controls và secrets management riêng.

## 9. Giới hạn, rủi ro và điều kiện trước khi nộp

- Không có dữ liệu cấp lệnh, queue position hoặc hidden liquidity; visible depth không phải guaranteed executable liquidity.
- Lịch sử synthetic và live hiện hữu chưa đủ để khẳng định khả năng tổng quát qua nhiều regime. Thêm lịch sử và thực hiện shadow evaluation trước khi diễn giải như bằng chứng vận hành.
- Chuyển đổi đơn vị SSI dựa trên tài liệu/ví dụ chính thức; cần spot-check với SSI tại đúng entitlement/environment trước khi dùng live.
- Quyền lưu trữ, xử lý và trình chiếu dữ liệu phụ thuộc hợp đồng/entitlement của nhà cung cấp.
- Sản phẩm không phải hệ thống suitability, tư vấn đầu tư, tuân thủ, quản lý rủi ro công ty chứng khoán, hay order-management system.
- Trước khi nộp: lưu bằng chứng giảng viên phê duyệt thay đổi nguồn; cài môi trường sạch; chạy test suite; kiểm tra demo không có credentials; lưu ảnh chụp UI, manifest và kết quả đầy đủ kể cả kết quả yếu.

Tài liệu học thuật và kỹ thuật được tổng hợp trong [references.md](references.md). Không có tuyên bố rằng prototype đã được chứng nhận ISO/SOC, được kiểm toán độc lập, hoặc đủ điều kiện production.
