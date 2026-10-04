# Kumi Data Vault UI

Giao diện GitHub Pages công khai cho **Kumi Data Vault**.

## Kiến trúc

- Repo này (**public**) chỉ chứa giao diện HTML/CSS/JavaScript.
- Dữ liệu thật nằm trong repo private `TruongTuan0102/kumi-data-vault`, nhánh `vault-data`, file `data/vault.json`.
- Không có GitHub token/PAT nào được lưu trong source code.
- Khi mở trang, người dùng nhập Fine-grained GitHub token; token chỉ được giữ trong `sessionStorage` của tab/trình duyệt.
- Token nên chỉ được cấp quyền cho repo private `kumi-data-vault` với **Contents: Read and write**.

## Tính năng

- Tìm kiếm fuzzy theo tên, tag và nội dung; hỗ trợ bỏ dấu và gõ gần đúng.
- Tự nhận diện RouterOS, PowerShell, Python, CMD/Batch, Bash/Shell, JavaScript, JSON, HTML/XML và CSS.
- Card thu gọn/mở rộng.
- Syntax highlighting.
- Copy toàn bộ nội dung.
- Thêm, sửa và xóa dữ liệu; thay đổi được commit vào nhánh `vault-data` của repo private.
- Dark/light mode.
- Ctrl+K để tìm, Ctrl+N để thêm.

## GitHub Pages

Vào **Settings → Pages → Build and deployment → Source → GitHub Actions**.

Workflow `.github/workflows/pages.yml` chỉ deploy thư mục `site/`.
