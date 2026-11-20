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

| Bậc Bloom | Bằng chứng có thể quan sát |
|---|---|
| Nhớ | Từ điển và hợp đồng dữ liệu cho SSI, NEO, synthetic; tên trường, đơn vị và dữ liệu thiếu. |
| Hiểu | Tài liệu phương pháp giải thích spread, depth, OBI, ILLIQ, LHS, cảnh báo và IS. |
| Vận dụng | Ghi dữ liệu, replay RAW thành curated, chạy phân tích và xem dashboard. |
| Phân tích | Phân rã score, cảnh báo theo baseline quá khứ, so sánh benchmark và chế độ phủ sổ. |
| Đánh giá | Walk-forward theo phiên, cluster bootstrap, khoảng tin cậy, chất lượng dữ liệu và giới hạn công khai. |
| Sáng tạo | Đề xuất giả thuyết mới, kiểm tra độ nhạy và thiết kế protocol cho cohort/nguồn mới. |

Liên hệ rubric học phần: vấn đề và người dùng được nêu tại §1–2; kỹ thuật dữ liệu tại §4–5; phương pháp và giả định tại §6; trải nghiệm tại dashboard Streamlit; kiểm chứng tại §7; tài liệu và quy trình chạy tại README cùng các tài liệu trong `docs/`. Đây là ánh xạ bằng chứng, không phải cam kết điểm số. Phần nguồn dữ liệu phải được giải thích cùng bằng chứng giảng viên duyệt vì khác yêu cầu mặc định NEO-core của đề.

### Đối chiếu 7 tiêu chí chấm điểm

| Tiêu chí | Điểm tối đa | Bằng chứng trong sản phẩm | Bằng chứng cần đưa vào bài nộp / bảo vệ |
|---|---:|---|---|
| Vấn đề và giá trị FinTech | 15 | Nhu cầu, người dùng, bốn câu hỏi quyết định tại §1–2; dashboard trả lời theo luồng công việc. | Trình diễn một tình huống người dùng hoàn chỉnh; nêu phản hồi/đánh giá người dùng nếu đã thu thập, không tự nhận có khảo sát nếu chưa làm. |
| Nguồn API và kỹ thuật dữ liệu | 20 | SSI FastConnect v3 làm nguồn thay thế đã được giảng viên duyệt; recorder, schema provider, canonical layer, RAW capture, quality flags và manifest; NEO adapter dự phòng. | Minh chứng duyệt SSI thay NEO; thông tin entitlement và manifest capture live khi được phép; không công bố credentials. |
| Phương pháp tài chính và phân tích | 20 | LHS, microstructure, anomaly screening, IS simulator; giả định và giới hạn ở §6 và `methodology.md`; kiểm chứng theo thời gian ở `validation_protocol.md`. | Báo cáo đầy đủ kết quả, benchmark, độ bất định và phân tích sensitivity; tách rõ synthetic với live. |
| Triển khai kỹ thuật | 20 | Python packages tách data/provider/finance/analytics/app; secrets qua environment; namespace provider; kiểm thử tự động. | Chụp phiên bản môi trường, mã nguồn và hướng dẫn chạy trên môi trường sạch; giải thích được các quyết định kỹ thuật. |
| Sản phẩm và trải nghiệm | 10 | Điều hướng 7 trang theo hai nhóm; bộ lọc phiên/watchlist dùng xuyên suốt; badge nguồn/chế độ/phiên/mốc dữ liệu; tổng quan có 5 KPI theo lát cắt, biểu đồ độ rộng và xếp hạng LHS, bảng watchlist; trang mô phỏng, cảnh báo có truy nguyên, kiểm chứng và phương pháp; empty/error states có hướng dẫn xử lý. | Ảnh chụp hoặc demo video thể hiện cả trạng thái bình thường và dữ liệu thiếu/lỗi; dùng đúng nhãn nguồn/chế độ. |
| Kiểm thử và kiểm chứng | 10 | Bộ kiểm thử tái lập, test tình huống lỗi, walk-forward, bootstrap theo phiên, khoảng tin cậy và kiểm tra chất lượng. | Đính kèm kết quả chạy test, protocol, dữ liệu/mã hash và các hạn chế; kiểm chứng kết nối live riêng nếu có entitlement. |
| Tài liệu và trình bày | 5 | README, hồ sơ sản phẩm, kiến trúc, phương pháp, mapping API, ngưỡng, giới hạn và nguồn tham khảo. | Hoàn thiện báo cáo 8–12 trang, thông tin sinh viên, ảnh sản phẩm/video bảo vệ và trích dẫn theo quy định môn học. |

Không suy ra điểm tuyệt đối chỉ từ việc có nhiều chức năng hoặc test pass. Phần chấm phụ thuộc chất lượng bằng chứng, khả năng giải thích, dữ liệu được phép sử dụng, và việc nộp đủ báo cáo/demo theo đề.

## 4. Kiến trúc hiện tại

```text
SSI FastConnect v3 (mặc định) ─┐
NEO API (backup chọn thủ công) ─┼─> recorder -> RAW có manifest và SHA-256
Synthetic xác định theo seed ──┘                  -> normalize + quality flags
                                                  -> curated Parquet
                                                  -> finance / analytics / simulator
                                                  -> Streamlit research dashboard
```

- **SSI:** SDK Python chính thức, stream dữ liệu thị trường, lưu message đã được SDK giải mã theo topic và tạo bản ghi canonical khi hiểu được schema/đơn vị. Đây không phải bản chụp byte packet trên wire.
- **NEO:** REST/WebSocket adapter chỉ cho dữ liệu thị trường, kích hoạt bằng `NEOSCOPE_PROVIDER=NEO`.
- **Synthetic:** bộ dữ liệu mô phỏng được gắn nhãn rõ, dùng để tái hiện pipeline và cơ chế kiểm thử, không được xem là bằng chứng thị trường.
- **Lưu trữ:** mỗi lần bắt đầu ghi live dùng một capture directory riêng. Callback SSI đưa message vào bounded queue trước khi worker ghi RAW; khi queue quá tải, phiên bị đánh dấu failed thay vì âm thầm bỏ dữ liệu. RAW giữ message đã giải mã, arrival timestamp, sequence, metadata cấu hình và digest; curated và results được tách theo provider.
- **Giao diện:** dashboard chỉ đọc artifacts đã xử lý; paper simulator không import provider client.

Chi tiết thành phần, vận hành và ranh giới tin cậy ở [architecture.md](architecture.md). Khóa và bí mật chỉ đọc từ biến môi trường; không lưu trong YAML, manifest hoặc log.

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
