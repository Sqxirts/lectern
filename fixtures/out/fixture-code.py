"""A multi-line docstring so the highlighter has to span lines.
Second line of the docstring.
"""

import os


class Example:
    def __init__(self, name: str) -> None:
        self.name = name  # trailing comment

    def greet(self) -> str:
        return f"hello {self.name}"


if __name__ == "__main__":
    print(Example(os.getcwd()).greet())
