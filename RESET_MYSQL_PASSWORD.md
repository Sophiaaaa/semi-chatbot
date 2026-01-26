# MySQL 密码重置指南 (Access Denied 修复)

如果您的代码提示 `Access denied for user 'root'@'localhost'`，且您确认 `.env` 中的密码正确，通常是因为：
1. 本地 MySQL 的 `root` 密码确实不是该值。
2. 或者 `root` 用户被限制无法从该方式登录。

## 方案 A：使用脚本重置 root 密码（仅限 Mac/Linux 开发环境）

如果这是一个本地测试数据库，您可以尝试重置 root 密码。

1. **停止 MySQL 服务** (根据您的安装方式，可能是 `brew services stop mysql` 或系统设置中停止)
2. **以安全模式启动** (跳过权限检查):
   ```bash
   sudo mysqld_safe --skip-grant-tables &
   ```
3. **无密码登录**:
   ```bash
   mysql -u root
   ```
4. **重置密码**:
   ```sql
   FLUSH PRIVILEGES;
   ALTER USER 'root'@'localhost' IDENTIFIED BY 'root';
   FLUSH PRIVILEGES;
   EXIT;
   ```
5. **重启 MySQL 服务**。

## 方案 B：创建一个新用户（推荐）

为了避免破坏 root 权限，建议创建一个专用的开发用户。

1. 用您知道的任何有权限的账号登录 MySQL。
2. 执行以下 SQL：
   ```sql
   CREATE USER 'dev_user'@'%' IDENTIFIED BY 'dev_pass';
   GRANT ALL PRIVILEGES ON *.* TO 'dev_user'@'%';
   FLUSH PRIVILEGES;
   ```
3. 修改 `.env` 文件：
   ```ini
   DB_USER=dev_user
   DB_PASSWORD=dev_pass
   ```
