from asyncore import write
import code

class ScryptedConsole(code.InteractiveConsole):
    def write(self, data: str) -> None:
        return super().write(data)

    def raw_input(self, prompt: str) -> str:
        return super().raw_input(prompt=prompt)
