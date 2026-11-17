function errorHandler(error, req, res, next) {
    if (res.headersSent) {
        return next(error);
    }

    let status = error.statusCode || error.status || 500;
    let message = error.message;

    if (error.type === 'entity.parse.failed') {
        status = 400;
        message = 'Nội dung JSON không hợp lệ';
    } else if (error.type === 'entity.too.large') {
        status = 413;
        message = 'Dữ liệu gửi lên vượt quá kích thước cho phép';
    } else if (error.code === 'ER_ROW_IS_REFERENCED_2') {
        status = 409;
        message = 'Dữ liệu đang được đơn hàng sử dụng';
    }

    if (!Number.isInteger(status) || status < 400 || status > 599) {
        status = 500;
    }
    if (status >= 500) {
        console.error('API error:', error.code || error.name || 'Error');
        message = 'Lỗi máy chủ. Vui lòng thử lại sau';
    }

    return res.status(status).json({ success: false, message });
}

module.exports = errorHandler;
