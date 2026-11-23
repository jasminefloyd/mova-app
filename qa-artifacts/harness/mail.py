import smtpd,asyncore
from pathlib import Path
from time import time_ns
import sys
class Sink(smtpd.SMTPServer):
    def process_message(self,peer,mailfrom,rcpttos,data,**kwargs):
        Path(sys.argv[1],str(time_ns())+'.eml').write_bytes(data)
        print('local mail captured',flush=True)
sink=Sink(('127.0.0.1',55424),None)
asyncore.loop()
