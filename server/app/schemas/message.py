from enum import Enum


class ResponseStyle(str, Enum):
    NORMAL = "normal"
    CONCISE = "concise"
    DETAILED = "detailed"
