from typing import Annotated

from pydantic import PlainSerializer


BigIntID = Annotated[
    int,
    PlainSerializer(lambda value: str(value), return_type=str, when_used="json"),
]
