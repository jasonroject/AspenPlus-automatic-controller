"""Aspen 适配器的错误类型；message 一律面向用户（中文），原始异常放在 __cause__。"""


class AspenError(RuntimeError):
    """可预期的、需要告诉用户怎么办的错误。"""


class AspenUnavailable(AspenError):
    """未安装 Aspen、COM 未注册、缺 pywin32、许可证/启动失败。"""


class ModelOpenError(AspenError):
    """模型文件不存在、格式不支持或 Aspen 打不开。"""


class AspenTimeout(AspenError):
    """引擎运行超过限定时间，已请求停止/结束进程。"""


class AspenConnectionLost(AspenError):
    """COM 服务器中途消失（崩溃或被结束）。"""


class AspenStopped(AspenError):
    """调用方请求停止（should_stop 返回真）；引擎已请求停止，结果不可用。"""
