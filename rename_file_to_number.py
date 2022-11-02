from genericpath import isdir, isfile
import math
import os
import time
from sys import argv

if len(argv) < 3:
	print("""批量重命名文件
Usage: <dir> <file_ext> ... """)
	exit(1)

# 文件夹
path: str = argv[1]

# 文件后缀
file_ext_names: list[str] = argv[2:]

if isdir(path) == False:
	print(path + " is not a directory")
	exit(1)

fo_list: list[str] = [os.path.abspath(os.path.join(path, f)) for f in os.listdir(path)]

file_list: list[str] = [f for f in fo_list if isfile(f)]
dir_list: list[str] = [f for f in fo_list if isdir(f)]

if len(file_ext_names) == 1 and file_ext_names[0] == "$":
	file_ext_list = set(map(lambda t: os.path.splitext(t)[-1], file_list))
	file_ext_list = set(filter(lambda t: t != "", file_ext_list))
	# remove  "." of".jpg" output 
	file_ext_names = list(map(lambda t: t[1:], file_ext_list))

def sorted_by_file_time(file: str):
	return os.path.getmtime(file)

file_list: list[str] = sorted(file_list, key = lambda f: sorted_by_file_time(f))
file_list_len = len(file_list)
# 文件数量的数字的位数
file_list_len_number_digits = len(str(file_list_len))

file_ext_names_counter: dict[str, int] = {key:1 for key in file_ext_names}

# (1 = old file name  2 = new file name)
new_filename_map: list[tuple[str,str]] = [];

# 旧文件名对应新文件名 元组生成
for old_filepath in file_list:
	if old_filepath.count("_index.md") > 0: continue
	
	fn_block = old_filepath.split(".")

	if fn_block[-1] in file_ext_names_counter:
		file_count = str(file_ext_names_counter[fn_block[-1]])
		if len(file_count) < file_list_len_number_digits:
			for _ in range(file_list_len_number_digits - len(file_count)):
				file_count =  "0" + file_count

		create_time = time.strftime("%Y-%m-%d %Hh%Mm%Ss",  time.localtime(os.path.getmtime(old_filepath)))
		new_filepath = os.path.abspath(os.path.join(path,"(" 
		+ file_count + ") " + create_time + "." + fn_block[-1]))
		new_filename_map.append((old_filepath, new_filepath))
		file_ext_names_counter[fn_block[-1]] += 1

new_filename_map = [(o, n) for (o, n) in new_filename_map if o != n]

def print_filepath_diff(old_filepath: str, new_filepath: str):
	old_filepath_arr = old_filepath.split(os.path.sep)
	new_filepath_arr = new_filepath.split(os.path.sep)

	old_filepath_arr = [fp for fp in old_filepath_arr if fp != ""]
	new_filepath_arr = [fp for fp in new_filepath_arr if fp != ""]
	max_len = max(len(old_filepath_arr), len(new_filepath_arr))

	same_path = "/"
	old_diff_path = ""
	new_diff_path = ""

	for i in range(max_len):
		if old_filepath_arr[i] == new_filepath_arr[i]:
			same_path = os.path.join(same_path, old_filepath_arr[i])
		else:
			old_diff_path = os.path.join(old_diff_path, *old_filepath_arr[i:])
			new_diff_path = os.path.join(new_diff_path, *new_filepath_arr[i:])
			break
	print(same_path + os.path.sep + "{" + old_diff_path + " -> " + new_diff_path + "}")


for (old_filename, new_filepath) in new_filename_map:
	os.rename(old_filename, new_filepath)
	print_filepath_diff(old_filename, new_filepath)
	

exit(0)
