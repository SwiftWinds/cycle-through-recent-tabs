dist:
	zip -r cycle-through-recent-tabs.zip * -x ".*" -x "*Makefile*" -x "*README.md*" -x "*LICENSE*"

clean:
	rm -rf *.zip