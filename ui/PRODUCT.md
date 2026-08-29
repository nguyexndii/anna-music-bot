# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- Thành viên máy chủ Discord muốn nghe nhạc chung trong phòng thoại (Voice Channel), gọi bài hát yêu thích, xem lời bài hát và quản lý danh sách phát.
- DJ / Quản trị viên máy chủ cần quản lý hàng chờ phát nhạc, điều chỉnh âm lượng, kích hoạt chế độ lặp, xáo trộn bài hát hoặc bật chế độ 24/7 Lofi.

## Product Purpose

- Cung cấp giao diện Web Player & Live Dashboard thời gian thực hiện đại, cho phép người dùng điều khiển bot nhạc Anna Music trực tiếp từ trình duyệt web mà không cần phải nhớ các câu lệnh bot phức tạp trong Discord.
- Thành công được định nghĩa bằng: Độ trễ phản hồi tức thì (<100ms), tìm kiếm bài hát theo thời gian thực (Live Search as-you-type), lời bài hát Karaoke đồng bộ mượt mà, và xác thực một chạm qua Magic Token (.web) bảo mật không cần mật khẩu hay OAuth2 rườm rà.

## Positioning

- Khác với các bot âm nhạc Discord truyền thống chỉ tương tác qua chat command hoặc các web dashboard cồng kềnh đòi hỏi cấp quyền Discord OAuth2, Anna Music Web Player sử dụng **Magic Token HMAC SHA-256** được cấp qua lệnh `.web` trong Discord.
- Cơ chế nhận diện danh tính thông minh: Mọi bài hát thêm từ Web đều hiển thị chính xác tên và Avatar Discord của người gọi bài (`👤 Yêu cầu bởi: @TênUser 🌐`).

## Operating Context

- Môi trường: Trình duyệt web (Desktop, Tablet, Mobile) kết nối với Express API Backend của Bot Discord đang chạy trên VPS/Docker.
- Tương tác: Người dùng mở link `.web` từ Discord, tìm bài hát trên Live Search, bấm thêm vào hàng chờ, điều khiển phát/tạm dừng/âm lượng và xem Karaoke lyrics đồng bộ khi đang trò chuyện trong voice chat.

## Capabilities and Constraints

- **Live Search tức thời:** Tìm kiếm đa nguồn (YouTube, Spotify) với debounce 300ms, hiển thị ảnh bìa, kênh, thời lượng và nút phát ngay/thêm vào hàng chờ.
- **Hero Player Deck:** Đĩa than Vinyl xoay đồng bộ theo trạng thái phát, sóng âm thanh động (Equalizer Visualizer), thanh tiến trình Seekbar mượt mà.
- **Quản lý hàng chờ (Live Queue):** Hiển thị danh sách bài hát chờ phát, nhận diện avatar người gọi, nút xóa bài 1-click.
- **Karaoke Synced Lyrics:** Hiển thị lời bài hát cuộn đồng bộ theo mili-giây với hiệu ứng phát sáng dòng nhạc đang hát.
- **Điều khiển máy chủ:** Âm lượng (0 - 150%), chế độ Treo 24/7 Lofi không lời, chế độ lặp (Off / Bài này / Cả hàng chờ), xáo trộn danh sách.
- **Ràng buộc kỹ thuật:** Frontend SPA (React 18 + Vite + Tailwind CSS + Lucide Icons) phục vụ qua Express server trên cổng 3005.

## Brand Commitments

- **Tên:** Anna Music Web UI / Web Player
- **Bảng màu:** Dark Cyber Theme (`#111214` nền chính, `#1E1F22` bề mặt, `#2B2D31` thẻ card, `#3F4147` viền mờ kính, `#5865F2` Discord Blurple accent, `#EB459E` Pink glow, `#23A55A` Online Green).
- **Typography:** Phông chữ Plus Jakarta Sans kết hợp font mono cho thời lượng.
- **Phong cách:** Glassmorphism, Dark Mode sang trọng, viền bo tròn mềm mại (`rounded-2xl`, `rounded-3xl`), chuyển động mượt mà.

## Product Principles

1. **Tốc độ & Phản hồi tức thì:** Mọi thao tác tìm kiếm, bấm nút điều khiển phải cập nhật lạc quan (optimistic) ngay lập tức và đồng bộ chính xác với Voice Channel Discord.
2. **Trực quan & Tối giản:** Tập trung vào trải nghiệm nghe nhạc; đĩa quay Vinyl và sóng nhạc phản ánh trực tiếp trạng thái âm thanh.
3. **Danh tính minh bạch:** Luôn tôn trọng và ghi nhận rõ ràng ai là người đã yêu cầu bài hát trong hàng chờ.
4. **Trải nghiệm đồng bộ:** Lời bài hát Karaoke và thanh tiến trình cuộn mượt mà theo từng giây thực tế.
