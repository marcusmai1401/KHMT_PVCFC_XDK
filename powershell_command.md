# Cách 1: Start lần đầu + seed prod-like tự động
.\start-dev.cmd -SkipInstall -WithProdData -ResetUserPasswords

Push code lên main và deploy luôn

git checkout main
git pull origin main
git add .
git commit -m "Mo ta thay doi"
git push origin main


Nếu đang làm trên branch riêng thì quy trình nên là:

git checkout main
git pull origin main
git checkout -b feature/ten-task
# sửa code
git add .
git commit -m "Mo ta thay doi"
git push origin feature/ten-task