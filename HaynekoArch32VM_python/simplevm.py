"""
A simple virtual machine implementation. not an emulator of hayneko arch 32 S architecture.

A complex instruction set architecture (ISA) to maximize the instruction set and reduce the instruction length, like x86.

+-----------------------------+ total maximum 65536KB
| lower 1KB for ROM           |
+-----------------------------+
|                             |
|                             |
| upper 65535KB for mem       |
|                             |
|                             |
+-----------------------------+
|                             |
|                             |
|                             |
| maximum 256KB for disk      |
|                             |
|                             |
|                             |
+-----------------------------+



"""

import sys

import numpy
from PyQt5 import QtCore, QtGui, QtWidgets

class VM:
	def __init__(self, rom_file, disk_file, mem_size):
		self.registers_name_map = {
			"x0": 0,
			"ra": 1,
			"rb": 2,
			"rc": 3,
			"rd": 4,
			"ri": 5,
			"sp": 6,
			"bp": 7,
			"r8": 8,
			"r9": 9,
			"r10": 10,
			"r11": 11,
			"r12": 12,
			"r13": 13,
			"r14": 14,
			"r15": 15
		}
		self.flags_name_map = {   # bit position
			"cf": 0,
			"zf": 1,
			"of": 2,
			"nf": 3
		}

		self.rom_file = rom_file
		self.disk_file = disk_file
		self.mem_size = mem_size
		self.mem_size_bytes = mem_size * 1024

		self.ip = 0

		self.registers = numpy.zeros(16, dtype=numpy.uint32)
		self.flags = numpy.zeros(1, dtype=numpy.uint32) # 1 dword data for flags

		if mem_size <= 256 or mem_size >= 65536:
			raise ValueError("Memory size must be between 256 and 65536")

		self.memory = numpy.zeros(mem_size, dtype=numpy.uint8)

		self.__init_devices()

	def __delete__(self, instance):
		pass

	def __init_devices(self):
		# outer devices
		self.rom = open(self.rom_file, "r+b")
		self.disk = open(self.disk_file, "r+b") # r and w binary

	def __load_rom(self):
		rom_data = self.rom.read(1024)
		if len(rom_data) < 1024:
			rom_data += b'\x00' * (1024 - len(rom_data))
		self.memory[:1024] = numpy.frombuffer(rom_data, dtype=numpy.uint8)

	def __eject_devices(self):
		if self.rom is None or self.disk is None:
			return False
		self.rom.close()
		self.disk.close()
		return True

	def __read_reg(self, reg_name):
		if reg_name not in self.registers_name_map:
			raise ValueError("Invalid register name")
		return self.registers[self.registers_name_map[reg_name]]
	
	def __read_reg_num(self, id):
		if id >= 16 or id < 0:
			raise ValueError("Invalid register id")
		return self.registers[id]
	
	def __write_reg(self, reg_name, value):
		if reg_name not in self.registers_name_map:
			raise ValueError("Invalid register name")
		self.registers[self.registers_name_map[reg_name]] = self.tv(value)

	def __write_reg_id(self, id, value):
		if id >= 16 or id < 0:
			raise ValueError("Invalid register id")
		self.registers[id] = self.tv(value)

	def tv(self, value): # truncate value to 32 bits
		return value & 0xFFFFFFFF
	
	def tv8(self, value): # truncate value to 8 bits
		return value & 0xFF
	
	def __read_disk(self, position, length):
		self.disk.seek(position)
		return self.disk.read(length)

	def __write_disk(self, position, data_bytes):
		self.disk.seek(position)
		self.disk.write(data_bytes)

	def _get_flag(self, flag_name):
		return (self.flags[0] >> self.flags_name_map[flag_name]) & 1

	def _set_flag(self, flag_name, val):
		bit = self.flags_name_map[flag_name]
		if val:
			self.flags[0] |= (1 << bit)
		else:
			self.flags[0] &= ~(1 << bit)

	def _read_mem8(self, addr):
		addr = addr & 0xFFFFFFFF
		if addr >= self.mem_size_bytes:
			raise MemoryError(f"Read address {addr} out of bounds")
		return self.memory[addr]

	def _write_mem8(self, addr, val):
		addr = addr & 0xFFFFFFFF
		if addr >= self.mem_size_bytes:
			raise MemoryError(f"Write address {addr} out of bounds")
		self.memory[addr] = val & 0xFF

	def _read_mem32(self, addr):
		# big endian
		addr = addr & 0xFFFFFFFF
		if addr >= self.mem_size_bytes:
			raise MemoryError(f"Read address {addr} out of bounds")
		return (
			self.memory[addr] << 24 |
			self.memory[addr+1] << 16 |
			self.memory[addr+2] << 8 |
			self.memory[addr+3]
		)
	
	def _write_mem32(self, addr, val):
		addr = addr & 0xFFFFFFFF
		if addr >= self.mem_size_bytes:
			raise MemoryError(f"Write address {addr} out of bounds")
		self.memory[addr] = (val >> 24) & 0xFF
		self.memory[addr+1] = (val >> 16) & 0xFF
		self.memory[addr+2] = (val >> 8) & 0xFF
		self.memory[addr+3] = val & 0xFF




	# below is the executor

	def execute(self):
		inst = self.memory[self.ip]

		# check the instruction format to determine the instruction type and length
		i_length = self._determine_instruction_length(inst)

		# if inst is 1 byte, then execute
		# if inst is more then 1 byte, then read the following bytes
		if i_length == 1:
			self._execute_instruction(inst, 1)
		else:
			# read the following bytes
			i_bytes = self.memory[self.ip+1 : self.ip+i_length]
			self._execute_instruction(inst, i_bytes)

		self.ip += i_length

	def _determine_instruction_length(self, inst):
		"""
		0b00xxxxxx -> 1 byte
		0b01xxxxxx -> 2 bytes
		0b10xxxxxx -> 3 bytes
		0b11xxxxxx -> 4 bytes
		"""
		return inst >> 6 & 0xFF
		
	def _execute_instruction(self, inst, i_bytes):
		# no need to add ip in this funtion
		i_b_start, i_b1, i_b2, i_b3 = self.memory[self.ip], self.memory[self.ip+1], self.memory[self.ip+2], self.memory[self.ip+3]


	# below is the instruction handlers
	
	def _i_nop(self):
		pass


	def quit(self):
		if not self.__eject_devices():
			print("Failed to eject devices")
			sys.exit(1)

		sys.exit(0)

class Assembler:
	def __init__(self):
		pass



def immediate_init_disk():
	# create a 256KB file, fill with 0
	disk = open("disk.hvd", "wb")
	disk.write(bytes(256*1024))
	disk.close()

def immediate_init_rom():
	# create a 1KB file, fill with 0
	rom = open("rom.hvd", "wb")
	rom.write(bytes(1024))
	rom.close()

if __name__ == "__main__":
	# immediate_init_disk() # for debug
	# immediate_init_rom()
	...

	# vm.quit()