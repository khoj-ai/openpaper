from typing import Tuple


def get_start_page_from_offset(offsets: dict[int, Tuple[int, int]], offset: int) -> int:
    """
    Get the starting page number for a given text offset.
    """
    # Get last offset to ensure the offset is within bounds
    if not offsets:
        return -1  # Return -1 if no offsets are available
    last_page_num = max(offsets.keys())
    last_offset = offsets[last_page_num][1]
    if offset < 0 or offset >= last_offset:
        return -1  # Return -1 if the offset is out of bounds

    # Iterate through the offsets to find the page number for the given offset
    for page_num, (start, end) in offsets.items():
        if start <= offset < end:
            return page_num

    # Return -1 if no matching page is found. This condition should not occur if the offset is valid. Technically, the code should be unreachable given above checks, but need for completeness.
    return -1
