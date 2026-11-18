# SSI FastConnect API v3 integration

SSI FastConnect v3 is the default and primary live market-data provider in NeoScope; VPBankS NEO is the explicit backup. The integration uses the official Python SDK (`ssi-sdk==3.3.2`, current portal-documented release as of this document's review) and push-based market-data stream. Configured access is market-data only. The codebase does not instantiate SSI Trading clients and has no real order-entry workflow.

## Topics and mapping

| SSI topic | RAW channel | Canonical output | Notes |
|---|---|---|---|
| `quote` | `ssi_quote` | `stockInfo` | Keeps up to five bid/ask levels in adapter state; maps first three levels into the established research schema. Quote and market prices are converted from VND thousands to VND. |
| `trade` | `ssi_trade` | `stockInfo` | Trade `p`, `o`, `h`, `l`, `a` and cumulative volume `v`; prices and average are published in VND. Cumulative value is `a × v` when both are present. |
| `room` | `ssi_room` | `stockInfo` | Foreign room and remaining-room fields are mapped. SSI buy/sell quantity/value fields stay in RAW because their counter semantics are not specified in the current contract. |
| `market` | `ssi_market` | `stockInfo` | Reference, floor, and ceiling price; conversion to VND. |
| `indexsummary` | `ssi_indexsummary` | `marketInfo` | Index value, breadth, market session, cumulative matched/put-through volume and value. |
| Session flag / other | `ssi_unknown` or status | — | No fabricated equity fields. |

RAW records keep the SDK-decoded, SSI-shaped message, topic class, sequence, and local arrival timestamp; they are not packet-level copies of wire bytes. Canonical records are a derived compatibility layer, not a substitute for the decoded source fields. SSI does not publish the aggregate `totalBidQTTY`/`totalAskQTTY` fields expected by the previous provider adapter; those are left null.

## Credentials and environment

Set `SSI_CLIENT_ID`, `SSI_API_KEY`, and `SSI_API_SECRET` in `.env`. Credentials are not accepted from YAML and are never written to RAW, manifests, status files, or logs. Set `NEOSCOPE_MODE=LIVE` only after SSI has activated the API key and granted the required Market Data scopes. Confirm the portal environment and key before use; UAT and Production credentials are distinct. SSI is selected by default; set `NEOSCOPE_PROVIDER=NEO` to use the backup.

The SDK callback enqueues decoded messages for a dedicated RAW writer so compression and canonicalization do not block the WebSocket reader thread. The queue is bounded by `ssi_api.ingest_queue_size` (default 10,000); saturation stops the session with a failed status so a partial capture cannot look complete. Review the final manifest and status after each capture.

REST Market Data can authenticate without OTP. SSI's current Stream guidance is more restrictive in some flows and entitlements, so the recorder accepts an optional `SSI_OTP` only from the process environment and passes it to `Auth.authenticate(otp=...)` when present. If the approved market-data entitlement connects without OTP, leave the variable empty. NeoScope never requests, stores, prints, or logs an OTP, and it does not create an SSI Trading or Trading WebSocket client.

Switching provider requires an explicit `.env` change and recorder restart. Neither feed is silently substituted into the other provider's session. Each capture has a unique `LIVE_SSI_<date>_<time>_<capture-id>` namespace; NEO uses the corresponding `LIVE_NEO_...` prefix. Validation outputs also have provider-specific namespaces.

## REST (nhóm API thứ hai, chỉ Market Data)

Bên cạnh luồng WebSocket, NeoScope tích hợp REST client riêng (`src/neoscope/ssi_api/rest.py`) — **không dùng SDK cho REST** để parser phòng thủ được kiểm thử độc lập. Đường dẫn endpoint nằm trong `settings.yaml → ssi_api.rest` vì SSI có thể đổi phiên bản đường dẫn; parser chấp nhận nhiều dạng tên trường đã công bố (camel/snake, lồng `data` hoặc phẳng).

| Endpoint | Mục đích trong bài toán | Chuẩn hóa đầu ra |
|---|---|---|
| `api/v3/Market/AccessToken` | OAuth2 token (clientId/apiKey/apiSecret); cache theo TTL, refresh trước khi hết hạn và khi 401 | không lưu token ra đĩa/log |
| `api/v3/Market/DailyOHLCHistory` | Bối cảnh giá dài hạn: đối chiếu độ lớn giá, kiểm tra lệch đơn vị nghìn-đ/VND so với luồng tick, ngưỡng biến động dài hạn | `ohlc_frame()`: một cột một đại lượng, dedup theo ngày, loại `close ≤ 0` |
| `api/v3/Market/Securities` | Hợp lệ hóa watchlist trước khi subscribe stream | `securities_frame()`/`validate_watchlist()` |

Kỹ thuật dùng chung với client NEO: token-bucket tần suất (mặc định 5 RPS), backoff cho 429/5xx, báo cáo tuân thủ `compliance_report()`. Cả hai module REST đều **không có** hàm đặt/sửa/hủy lệnh — kiểm chứng tĩnh trong `tests/test_ssi_rest.py::test_module_has_no_trading_endpoints` và `tests/test_safety.py`.

## Data-use cautions

- A quote is a snapshot of the visible book, not a complete order-level feed. It cannot identify queue position or hidden liquidity.
- SSI's current quote contract documents complete visible-level lists and notes that a future upgrade may send changed values only. The adapter replaces the current book from the present full-list message. Recheck and redesign the update merge if SSI changes that contract; do not treat a sparse message as a complete book.
- Quote/book and market-band values follow the published examples' thousand-VND scale, while trade values use VND. Check a known symbol against SSI's display before interpreting live outputs.
- The daily average times daily volume approximates cumulative traded value using the published average field. It is not a reconstruction from every execution. Use source tick-level trades for trade-level studies.
- SSI documents foreign buy/sell quantity/value fields but the current contract does not specify whether they are per-event or session-cumulative. They are retained in RAW and excluded from cumulative-flow analytics until verified.
- Feed coverage, entitlement, market hours, and network interruption affect what the recorder observes. The manifest and quality panel should be examined before interpreting a result.

## Official references

- [SSI FastConnect system overview](https://developers.ssi.com.vn/en/docs/getting-started)
- [SSI Python SDK installation and version](https://developers.ssi.com.vn/en/docs/sdk/python/installation-requirements)
- [SSI Python SDK streaming methods](https://developers.ssi.com.vn/en/docs/sdk/python/service-classes)
- [SSI WebSocket market-data fields](https://developers.ssi.com.vn/en/docs/api-reference/subscribeUnsubscribeMarketData)
